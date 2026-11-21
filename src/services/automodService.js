import { PermissionFlagsBits } from 'discord.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { logModerationAction } from '../utils/moderation.js';
import { logger } from '../utils/logger.js';
import { WarningService } from './moderation/warningService.js';
import { ModerationService } from './moderation/moderationService.js';

const MAX_WORDS = 200;
const MAX_WORD_LENGTH = 100;
const MAX_VIOLATION_LEVELS = 10;

const AUTO_MOD_FILTERS = [
  'blacklist',
  'spam',
  'duplicates',
  'caps',
  'mentions',
  'invites',
  'links',
  'attachments',
  'repeatedCharacters',
  'editedMessages',
];

const VALID_PUNISHMENTS = new Set([
  'delete',
  'warn',
  'timeout_10m',
  'timeout_1h',
  'timeout_1d',
  'kick',
  'ban',
]);

const TIMEOUT_DURATIONS = {
  timeout_10m: 10 * 60 * 1000,
  timeout_1h: 60 * 60 * 1000,
  timeout_1d: 24 * 60 * 60 * 1000,
};

function configKey(guildId) {
  return `automod:${guildId}:config`;
}

function violationKey(guildId, userId) {
  return `automod:${guildId}:violations:${userId}`;
}

function defaultConfig() {
  return {
    enabled: false,

    filters: {
      blacklist: {
        enabled: false,
        words: [],
      },
      spam: { enabled: false },
      duplicates: { enabled: false },
      caps: { enabled: false },
      mentions: { enabled: false },
      invites: { enabled: false },
      links: { enabled: false },
      attachments: { enabled: false },
      repeatedCharacters: { enabled: false },
      editedMessages: { enabled: false },
    },

    punishments: [
      'delete',
      'delete',
      'warn',
      'warn',
      'warn',
      'timeout_10m',
      'timeout_1h',
      'timeout_1d',
      'kick',
      'ban',
    ],

    ignoredChannelIds: [],
    ignoredRoleIds: [],
    ignoredUserIds: [],
    bypassModerators: true,
    updatedAt: Date.now(),
  };
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function normalizeWord(word) {
  return word
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return [];

  return [...new Set(
    words
      .filter((word) => typeof word === 'string')
      .map(normalizeWord)
      .filter((word) => word.length > 0 && word.length <= MAX_WORD_LENGTH),
  )].slice(0, MAX_WORDS);
}

function normalizePunishments(punishments) {
  const defaults = defaultConfig().punishments;

  return Array.from(
    { length: MAX_VIOLATION_LEVELS },
    (_, index) => {
      const punishment = punishments?.[index];

      return VALID_PUNISHMENTS.has(punishment)
        ? punishment
        : defaults[index];
    },
  );
}

function normalizeFilters(config) {
  const defaults = defaultConfig().filters;
  const savedFilters = config?.filters || {};

  // Ondersteunt ook je oude config met alleen "words".
  const legacyWords = Array.isArray(config?.words) ? config.words : [];
  const savedBlacklist = savedFilters.blacklist || {};

  const filters = {};

  for (const filterName of AUTO_MOD_FILTERS) {
    filters[filterName] = {
      ...defaults[filterName],
      ...(savedFilters[filterName] || {}),
      enabled: savedFilters[filterName]?.enabled === true,
    };
  }

  filters.blacklist = {
    ...defaults.blacklist,
    ...savedBlacklist,
    words: normalizeWords(savedBlacklist.words || legacyWords),
    // Een bestaande blacklist blijft werken na de upgrade.
    enabled: savedFilters.blacklist?.enabled === true ||
      (
        !savedFilters.blacklist &&
        config?.enabled === true &&
        legacyWords.length > 0
      ),
  };

  return filters;
}

function normalizeConfig(config) {
  const base = defaultConfig();
  const value = config && typeof config === 'object' ? config : {};
  const filters = normalizeFilters(value);

  return {
    enabled: value.enabled === true,
    filters,

    // Behouden voor compatibiliteit met oudere dashboardcode.
    words: filters.blacklist.words,

    punishments: normalizePunishments(value.punishments),
    ignoredChannelIds: uniqueStrings(value.ignoredChannelIds),
    ignoredRoleIds: uniqueStrings(value.ignoredRoleIds),
    ignoredUserIds: uniqueStrings(value.ignoredUserIds),
    bypassModerators: value.bypassModerators !== false,
    updatedAt: Number(value.updatedAt) || base.updatedAt,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMessageContent(content) {
  return content
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesBlacklistedWord(content, word) {
  const expression = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegex(word)}(?=$|[^\\p{L}\\p{N}_])`,
    'iu',
  );

  return expression.test(content);
}

function displayPunishment(punishment) {
  const labels = {
    delete: 'Delete message only',
    warn: 'Warn',
    timeout_10m: 'Timeout for 10 minutes',
    timeout_1h: 'Timeout for 1 hour',
    timeout_1d: 'Timeout for 1 day',
    kick: 'Kick',
    ban: 'Ban',
  };

  return labels[punishment] || 'Delete message only';
}

function getPunishmentForViolation(config, violationNumber) {
  const level = Math.min(
    Math.max(violationNumber, 1),
    MAX_VIOLATION_LEVELS,
  );

  return config.punishments[level - 1];
}

function buildReason(word, violationNumber) {
  return `AutoMod blacklist match: "${word}" | Violation ${violationNumber}`;
}

async function getBotMember(guild) {
  return guild.members.me || guild.members.fetchMe();
}

async function getTargetMember(message) {
  return message.member ||
    message.guild.members.fetch(message.author.id).catch(() => null);
}

async function shouldIgnoreMessage(message, config) {
  if (!config.enabled) return true;
  if (!message.guild || message.author.bot) return true;
  if (config.ignoredUserIds.includes(message.author.id)) return true;
  if (config.ignoredChannelIds.includes(message.channel.id)) return true;

  const member = await getTargetMember(message);

  if (!member) return false;

  if (config.ignoredRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
    return true;
  }

  return (
    config.bypassModerators &&
    member.permissions.has(PermissionFlagsBits.ManageMessages)
  );
}

async function addAutoModViolation(guildId, userId, word) {
  const current = await getAutoModViolations(guildId, userId);

  const next = {
    count: current.count + 1,
    lastViolationAt: Date.now(),
    lastWord: word,
  };

  await setInDb(violationKey(guildId, userId), next);
  return next;
}

async function createDeleteOnlyCase({
  client,
  guild,
  user,
  word,
  violationNumber,
  punishment,
}) {
  const botMember = await getBotMember(guild);

  return logModerationAction({
    client,
    guild,
    event: {
      action: 'AutoMod Message Deleted',
      target: `${user.tag} (${user.id})`,
      executor: `${botMember.user.tag} (${botMember.id})`,
      reason: buildReason(word, violationNumber),
      metadata: {
        userId: user.id,
        moderatorId: botMember.id,
        automod: true,
        matchedWord: word,
        violationNumber,
        punishment: displayPunishment(punishment),
      },
    },
  });
}

async function applyAutoModPunishment({
  client,
  message,
  word,
  violationNumber,
  punishment,
}) {
  const { guild, author: user } = message;
  const reason = buildReason(word, violationNumber);
  const botMember = await getBotMember(guild);
  const targetMember = await getTargetMember(message);

  if (punishment === 'delete') {
    return {
      caseId: await createDeleteOnlyCase({
        client,
        guild,
        user,
        word,
        violationNumber,
        punishment,
      }),
      action: 'Delete message only',
    };
  }

  if (!targetMember) {
    throw new Error('Could not find the member who triggered AutoMod.');
  }

  if (punishment === 'warn') {
    const warning = await WarningService.addWarning({
      guildId: guild.id,
      userId: user.id,
      moderatorId: botMember.id,
      reason,
      timestamp: Date.now(),
    });

    const caseId = await logModerationAction({
      client,
      guild,
      event: {
        action: 'User Warned',
        target: `${user.tag} (${user.id})`,
        executor: `${botMember.user.tag} (${botMember.id})`,
        reason,
        metadata: {
          userId: user.id,
          moderatorId: botMember.id,
          automod: true,
          matchedWord: word,
          violationNumber,
          warningId: warning.id,
          totalWarns: warning.totalCount,
          punishment: displayPunishment(punishment),
        },
      },
    });

    return { caseId, action: 'Warn' };
  }

  if (TIMEOUT_DURATIONS[punishment]) {
    const result = await ModerationService.timeoutUser({
      guild,
      member: targetMember,
      moderator: botMember,
      durationMs: TIMEOUT_DURATIONS[punishment],
      reason,
    });

    return {
      caseId: result.caseId,
      action: displayPunishment(punishment),
    };
  }

  if (punishment === 'kick') {
    const result = await ModerationService.kickUser({
      guild,
      member: targetMember,
      moderator: botMember,
      reason,
    });

    return { caseId: result.caseId, action: 'Kick' };
  }

  if (punishment === 'ban') {
    const result = await ModerationService.banUser({
      guild,
      user,
      moderator: botMember,
      reason,
    });

    return { caseId: result.caseId, action: 'Ban' };
  }

  throw new Error(`Unknown AutoMod punishment: ${punishment}`);
}

export async function getAutoModConfig(guildId) {
  const savedConfig = await getFromDb(configKey(guildId), null);
  return normalizeConfig(savedConfig);
}

export async function saveAutoModConfig(guildId, config) {
  const normalized = normalizeConfig({
    ...config,
    updatedAt: Date.now(),
  });

  await setInDb(configKey(guildId), normalized);
  return normalized;
}

export async function updateAutoModConfig(guildId, updates) {
  const current = await getAutoModConfig(guildId);

  return saveAutoModConfig(guildId, {
    ...current,
    ...updates,
    filters: {
      ...current.filters,
      ...(updates.filters || {}),
      blacklist: {
        ...current.filters.blacklist,
        ...(updates.filters?.blacklist || {}),
      },
    },
  });
}

export async function setAutoModEnabled(guildId, enabled) {
  return updateAutoModConfig(guildId, {
    enabled: Boolean(enabled),
  });
}

export async function setAutoModFilterEnabled(guildId, filterName, enabled) {
  if (!AUTO_MOD_FILTERS.includes(filterName)) {
    throw new Error(`Unknown AutoMod filter: ${filterName}`);
  }

  return updateAutoModConfig(guildId, {
    filters: {
      [filterName]: {
        enabled: Boolean(enabled),
      },
    },
  });
}

export async function setAutoModWords(guildId, words) {
  return updateAutoModConfig(guildId, {
    filters: {
      blacklist: {
        words: normalizeWords(words),
      },
    },
  });
}

export async function setAutoModPunishment(guildId, level, punishment) {
  if (
    !Number.isInteger(level) ||
    level < 1 ||
    level > MAX_VIOLATION_LEVELS
  ) {
    throw new Error(
      `AutoMod punishment level must be between 1 and ${MAX_VIOLATION_LEVELS}.`,
    );
  }

  if (!VALID_PUNISHMENTS.has(punishment)) {
    throw new Error('Invalid AutoMod punishment.');
  }

  const config = await getAutoModConfig(guildId);
  config.punishments[level - 1] = punishment;

  return saveAutoModConfig(guildId, config);
}

export async function getAutoModViolations(guildId, userId) {
  const value = await getFromDb(violationKey(guildId, userId), null);

  return {
    count: Math.max(0, Number(value?.count) || 0),
    lastViolationAt: Number(value?.lastViolationAt) || null,
    lastWord: typeof value?.lastWord === 'string'
      ? value.lastWord
      : null,
  };
}

export async function resetAutoModViolations(guildId, userId) {
  const resetValue = {
    count: 0,
    lastViolationAt: null,
    lastWord: null,
  };

  await setInDb(violationKey(guildId, userId), resetValue);
  return resetValue;
}

export async function findBlacklistedWord(content, words) {
  if (!content || !words.length) return null;

  const normalizedContent = normalizeMessageContent(content);

  for (const word of words) {
    if (matchesBlacklistedWord(normalizedContent, word)) {
      return word;
    }
  }

  return null;
}

export async function processAutoModMessage(message, client) {
  try {
    if (!message.guild || message.author.bot || !message.content) {
      return { matched: false, ignored: true };
    }

    const config = await getAutoModConfig(message.guild.id);

    if (await shouldIgnoreMessage(message, config)) {
      return { matched: false, ignored: true };
    }

    // Momenteel is alleen blacklist geïmplementeerd.
    // Alle toekomstige filters bestaan al in de config, maar doen niets totdat
    // we ze apart hebben gebouwd en jij ze inschakelt.
    if (!config.filters.blacklist.enabled) {
      return { matched: false, ignored: false };
    }

    const word = await findBlacklistedWord(
      message.content,
      config.filters.blacklist.words,
    );

    if (!word) {
      return { matched: false, ignored: false };
    }

    try {
      await message.delete();
    } catch (error) {
      logger.error('AutoMod could not delete a blacklisted message:', error);

      return {
        matched: true,
        enforced: false,
        word,
        error: 'I could not delete the message. Check my Manage Messages permission.',
      };
    }

    const violation = await addAutoModViolation(
      message.guild.id,
      message.author.id,
      word,
    );

    const punishment = getPunishmentForViolation(
      config,
      violation.count,
    );

    const result = await applyAutoModPunishment({
      client,
      message,
      word,
      violationNumber: violation.count,
      punishment,
    });

    logger.info(
      `AutoMod enforced in ${message.guild.name}: ${message.author.tag} violated "${word}" for the ${violation.count} time.`,
    );

    return {
      matched: true,
      enforced: true,
      word,
      violationNumber: violation.count,
      punishment,
      caseId: result.caseId,
      action: result.action,
    };
  } catch (error) {
    logger.error('AutoMod processing failed:', error);

    return {
      matched: false,
      enforced: false,
      error: error.message,
    };
  }
}

export {
  AUTO_MOD_FILTERS,
  MAX_VIOLATION_LEVELS,
  VALID_PUNISHMENTS,
  displayPunishment,
};

/* import { PermissionFlagsBits } from 'discord.js';
import { getFromDb, setInDb } from '../utils/database.js';
import { logModerationAction } from '../utils/moderation.js';
import { logger } from '../utils/logger.js';
import { WarningService } from './moderation/warningService.js';
import { ModerationService } from './moderation/moderationService.js';

const MAX_WORDS = 200;
const MAX_WORD_LENGTH = 100;
const MAX_VIOLATION_LEVELS = 5;

const VALID_PUNISHMENTS = new Set([
  'delete',
  'warn',
  'timeout_10m',
  'timeout_1h',
  'timeout_1d',
  'kick',
  'ban',
]);

const TIMEOUT_DURATIONS = {
  timeout_10m: 10 * 60 * 1000,
  timeout_1h: 60 * 60 * 1000,
  timeout_1d: 24 * 60 * 60 * 1000,
};

function configKey(guildId) {
  return `automod:${guildId}:config`;
}

function violationKey(guildId, userId) {
  return `automod:${guildId}:violations:${userId}`;
}

function defaultConfig() {
  return {
    enabled: false,
    words: [],
    punishments: [
      'delete',
      'warn',
      'timeout_10m',
      'timeout_1h',
      'timeout_1d',
    ],
    ignoredChannelIds: [],
    ignoredRoleIds: [],
    ignoredUserIds: [],
    bypassModerators: true,
    updatedAt: Date.now(),
  };
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function normalizeWord(word) {
  return word
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return [];

  return [...new Set(
    words
      .filter((word) => typeof word === 'string')
      .map(normalizeWord)
      .filter((word) => word.length > 0 && word.length <= MAX_WORD_LENGTH),
  )].slice(0, MAX_WORDS);
}

function normalizePunishments(punishments) {
  const defaults = defaultConfig().punishments;
  const result = [];

  for (let index = 0; index < MAX_VIOLATION_LEVELS; index += 1) {
    const punishment = punishments?.[index];

    result.push(
      VALID_PUNISHMENTS.has(punishment)
        ? punishment
        : defaults[index],
    );
  }

  return result;
}

function normalizeConfig(config) {
  const base = defaultConfig();
  const value = config && typeof config === 'object' ? config : {};

  return {
    enabled: value.enabled === true,
    words: normalizeWords(value.words),
    punishments: normalizePunishments(value.punishments),
    ignoredChannelIds: uniqueStrings(value.ignoredChannelIds),
    ignoredRoleIds: uniqueStrings(value.ignoredRoleIds),
    ignoredUserIds: uniqueStrings(value.ignoredUserIds),
    bypassModerators: value.bypassModerators !== false,
    updatedAt: Number(value.updatedAt) || base.updatedAt,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMessageContent(content) {
  return content
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesBlacklistedWord(content, word) {
  const escapedWord = escapeRegex(word);

  const expression = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapedWord}(?=$|[^\\p{L}\\p{N}_])`,
    'iu',
  );

  return expression.test(content);
}

function displayPunishment(punishment) {
  const labels = {
    delete: 'Delete message only',
    warn: 'Warn',
    timeout_10m: 'Timeout for 10 minutes',
    timeout_1h: 'Timeout for 1 hour',
    timeout_1d: 'Timeout for 1 day',
    kick: 'Kick',
    ban: 'Ban',
  };

  return labels[punishment] || 'Delete message only';
}

function getPunishmentForViolation(config, violationNumber) {
  const level = Math.min(
    Math.max(violationNumber, 1),
    MAX_VIOLATION_LEVELS,
  );

  return config.punishments[level - 1];
}

function buildReason(word, violationNumber) {
  return `AutoMod blacklist match: "${word}" | Violation ${violationNumber}`;
}

async function getBotMember(guild) {
  if (guild.members.me) {
    return guild.members.me;
  }

  return guild.members.fetchMe();
}

async function getTargetMember(message) {
  if (message.member) {
    return message.member;
  }

  return message.guild.members.fetch(message.author.id).catch(() => null);
}

export async function getAutoModConfig(guildId) {
  const savedConfig = await getFromDb(configKey(guildId), null);
  return normalizeConfig(savedConfig);
}

export async function saveAutoModConfig(guildId, config) {
  const normalized = normalizeConfig({
    ...config,
    updatedAt: Date.now(),
  });

  await setInDb(configKey(guildId), normalized);
  return normalized;
}

export async function updateAutoModConfig(guildId, updates) {
  const current = await getAutoModConfig(guildId);

  return saveAutoModConfig(guildId, {
    ...current,
    ...updates,
  });
}

export async function setAutoModEnabled(guildId, enabled) {
  return updateAutoModConfig(guildId, {
    enabled: Boolean(enabled),
  });
}

export async function setAutoModWords(guildId, words) {
  return updateAutoModConfig(guildId, {
    words: normalizeWords(words),
  });
}

export async function setAutoModPunishment(guildId, level, punishment) {
  if (!Number.isInteger(level) || level < 1 || level > MAX_VIOLATION_LEVELS) {
    throw new Error(`AutoMod punishment level must be between 1 and ${MAX_VIOLATION_LEVELS}.`);
  }

  if (!VALID_PUNISHMENTS.has(punishment)) {
    throw new Error('Invalid AutoMod punishment.');
  }

  const config = await getAutoModConfig(guildId);
  config.punishments[level - 1] = punishment;

  return saveAutoModConfig(guildId, config);
}

export async function getAutoModViolations(guildId, userId) {
  const value = await getFromDb(violationKey(guildId, userId), null);

  return {
    count: Math.max(0, Number(value?.count) || 0),
    lastViolationAt: Number(value?.lastViolationAt) || null,
    lastWord: typeof value?.lastWord === 'string' ? value.lastWord : null,
  };
}

export async function resetAutoModViolations(guildId, userId) {
  const resetValue = {
    count: 0,
    lastViolationAt: null,
    lastWord: null,
  };

  await setInDb(violationKey(guildId, userId), resetValue);
  return resetValue;
}

async function addAutoModViolation(guildId, userId, word) {
  const current = await getAutoModViolations(guildId, userId);

  const next = {
    count: current.count + 1,
    lastViolationAt: Date.now(),
    lastWord: word,
  };

  await setInDb(violationKey(guildId, userId), next);
  return next;
}

async function shouldIgnoreMessage(message, config) {
  if (!config.enabled) return true;
  if (!message.guild || message.author.bot) return true;
  if (config.ignoredUserIds.includes(message.author.id)) return true;
  if (config.ignoredChannelIds.includes(message.channel.id)) return true;

  const member = await getTargetMember(message);

  if (!member) return false;

  if (config.ignoredRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
    return true;
  }

  if (
    config.bypassModerators &&
    member.permissions.has(PermissionFlagsBits.ManageMessages)
  ) {
    return true;
  }

  return false;
}

export async function findBlacklistedWord(content, words) {
  if (!content || !words.length) return null;

  const normalizedContent = normalizeMessageContent(content);

  for (const word of words) {
    if (matchesBlacklistedWord(normalizedContent, word)) {
      return word;
    }
  }

  return null;
}

async function createDeleteOnlyCase({
  client,
  guild,
  user,
  word,
  violationNumber,
  punishment,
}) {
  return logModerationAction({
    client,
    guild,
    event: {
      action: 'AutoMod Message Deleted',
      target: `${user.tag} (${user.id})`,
      executor: `${guild.members.me.user.tag} (${guild.members.me.id})`,
      reason: buildReason(word, violationNumber),
      metadata: {
        userId: user.id,
        moderatorId: guild.members.me.id,
        automod: true,
        matchedWord: word,
        violationNumber,
        punishment: displayPunishment(punishment),
      },
    },
  });
}

async function applyAutoModPunishment({
  client,
  message,
  word,
  violationNumber,
  punishment,
}) {
  const { guild, author: user } = message;
  const reason = buildReason(word, violationNumber);
  const botMember = await getBotMember(guild);
  const targetMember = await getTargetMember(message);

  if (punishment === 'delete') {
    const caseId = await createDeleteOnlyCase({
      client,
      guild,
      user,
      word,
      violationNumber,
      punishment,
    });

    return {
      caseId,
      action: 'Delete message only',
    };
  }

  if (!targetMember) {
    throw new Error('Could not find the member who triggered AutoMod.');
  }

  if (punishment === 'warn') {
    const warning = await WarningService.addWarning({
      guildId: guild.id,
      userId: user.id,
      moderatorId: botMember.id,
      reason,
      timestamp: Date.now(),
    });

    const caseId = await logModerationAction({
      client,
      guild,
      event: {
        action: 'User Warned',
        target: `${user.tag} (${user.id})`,
        executor: `${botMember.user.tag} (${botMember.id})`,
        reason,
        metadata: {
          userId: user.id,
          moderatorId: botMember.id,
          automod: true,
          matchedWord: word,
          violationNumber,
          warningId: warning.id,
          totalWarns: warning.totalCount,
          punishment: displayPunishment(punishment),
        },
      },
    });

    return {
      caseId,
      action: 'Warn',
    };
  }

  if (TIMEOUT_DURATIONS[punishment]) {
    const result = await ModerationService.timeoutUser({
      guild,
      member: targetMember,
      moderator: botMember,
      durationMs: TIMEOUT_DURATIONS[punishment],
      reason,
    });

    return {
      caseId: result.caseId,
      action: displayPunishment(punishment),
    };
  }

  if (punishment === 'kick') {
    const result = await ModerationService.kickUser({
      guild,
      member: targetMember,
      moderator: botMember,
      reason,
    });

    return {
      caseId: result.caseId,
      action: 'Kick',
    };
  }

  if (punishment === 'ban') {
    const result = await ModerationService.banUser({
      guild,
      user,
      moderator: botMember,
      reason,
    });

    return {
      caseId: result.caseId,
      action: 'Ban',
    };
  }

  throw new Error(`Unknown AutoMod punishment: ${punishment}`);
}

export async function processAutoModMessage(message, client) {
  try {
    if (!message.guild || message.author.bot || !message.content) {
      return {
        matched: false,
        ignored: true,
      };
    }

    const config = await getAutoModConfig(message.guild.id);

    if (await shouldIgnoreMessage(message, config)) {
      return {
        matched: false,
        ignored: true,
      };
    }

    const word = await findBlacklistedWord(message.content, config.words);

    if (!word) {
      return {
        matched: false,
        ignored: false,
      };
    }

    try {
      await message.delete();
    } catch (error) {
      logger.error('AutoMod could not delete a blacklisted message:', error);

      return {
        matched: true,
        enforced: false,
        word,
        error: 'I could not delete the message. Check my Manage Messages permission.',
      };
    }

    const violation = await addAutoModViolation(
      message.guild.id,
      message.author.id,
      word,
    );

    const punishment = getPunishmentForViolation(config, violation.count);

    const result = await applyAutoModPunishment({
      client,
      message,
      word,
      violationNumber: violation.count,
      punishment,
    });

    logger.info(
      `AutoMod enforced in ${message.guild.name}: ${message.author.tag} violated "${word}" for the ${violation.count} time.`,
    );

    return {
      matched: true,
      enforced: true,
      word,
      violationNumber: violation.count,
      punishment,
      caseId: result.caseId,
      action: result.action,
    };
  } catch (error) {
    logger.error('AutoMod processing failed:', error);

    return {
      matched: false,
      enforced: false,
      error: error.message,
    };
  }
}

export {
  MAX_VIOLATION_LEVELS,
  VALID_PUNISHMENTS,
  displayPunishment,
};
*/
