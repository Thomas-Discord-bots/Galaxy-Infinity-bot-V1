import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
  MAX_VIOLATION_LEVELS,
  VALID_PUNISHMENTS,
  displayPunishment,
  getAutoModConfig,
  resetAutoModViolations,
  setAutoModEnabled,
  setAutoModFilterEnabled,
  setAutoModPunishment,
  setAutoModWords,
  updateAutoModConfig,
} from '../../services/automodService.js';

const PUNISHMENT_CHOICES = [
  { label: 'Delete message only', value: 'delete' },
  { label: 'Warn', value: 'warn' },
  { label: 'Timeout for 10 minutes', value: 'timeout_10m' },
  { label: 'Timeout for 1 hour', value: 'timeout_1h' },
  { label: 'Timeout for 1 day', value: 'timeout_1d' },
  { label: 'Kick', value: 'kick' },
  { label: 'Ban', value: 'ban' },
];

const FILTER_LABELS = {
  blacklist: 'Blacklist',
  spam: 'Spam',
  duplicates: 'Duplicates',
  invites: 'Invites',
  links: 'Links',
};

function parseLines(value) {
  return [...new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function parseIds(value) {
  return parseLines(value).filter((id) => /^\d{15,25}$/.test(id));
}

function parseNumberSettings(value) {
  const settings = {};

  for (const line of value.split(/[\n,]/)) {
    const match = line.trim().match(/^([a-z_]+)\s*=\s*(\d+)$/i);

    if (!match) continue;

    settings[match[1].toLowerCase()] = Number(match[2]);
  }

  return settings;
}

function enabledText(enabled) {
  return enabled ? 'Enabled' : 'Disabled';
}

function filterStatus(config) {
  return [
    `Blacklist: ${enabledText(config.filters.blacklist.enabled)}`,
    `Spam: ${enabledText(config.filters.spam.enabled)}`,
    `Duplicates: ${enabledText(config.filters.duplicates.enabled)}`,
    `Invites: ${enabledText(config.filters.invites.enabled)}`,
    `Links: ${enabledText(config.filters.links.enabled)}`,
  ].join('\n');
}

function formatWords(words) {
  if (!words.length) return 'None';

  const visible = words.slice(0, 10);
  const remaining = words.length - visible.length;

  return remaining > 0
    ? `${visible.join(', ')} and ${remaining} more`
    : visible.join(', ');
}

function buildDashboardEmbed(config, selectedLevel = null, view = 'main') {
  const punishmentLines = config.punishments
    .map((punishment, index) => {
      const selected = selectedLevel === index + 1 ? 'Current: ' : '';
      return `Level ${index + 1}: ${selected}${displayPunishment(punishment)}`;
    })
    .join('\n');

  const description = [
    `AutoMod: **${enabledText(config.enabled)}**`,
    '',
    'Filters:',
    filterStatus(config),
    '',
    `Blacklist words: **${config.words.length}**`,
    `Ignored channels: **${config.ignoredChannelIds.length}**`,
    `Ignored roles: **${config.ignoredRoleIds.length}**`,
    `Ignored users: **${config.ignoredUserIds.length}**`,
  ];

  if (view === 'main') {
    description.push(
      '',
      'Blacklist preview:',
      formatWords(config.words),
    );
  }

  if (view === 'punishments') {
    description.push(
      '',
      'Punishment ladder:',
      punishmentLines,
      '',
      'From violation 11 onward, AutoMod keeps using level 10.',
    );
  }

  if (view === 'filters') {
    description.push(
      '',
      `Spam settings: ${config.filters.spam.maxMessages} messages in ${config.filters.spam.windowSeconds} seconds`,
      `Duplicate settings: ${config.filters.duplicates.maxDuplicates} identical messages in ${config.filters.duplicates.windowSeconds} seconds`,
      `Link whitelist: ${config.filters.links.allowedDomains.length} domains`,
    );
  }

  return createEmbed({
    title: 'AutoMod Dashboard',
    description: description.join('\n'),
    color: config.enabled ? 'primary' : 'warning',
  });
}

function mainButtons(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_toggle')
        .setLabel(config.enabled ? 'Disable AutoMod' : 'Enable AutoMod')
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('automod_filters')
        .setLabel('Filters')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_punishments')
        .setLabel('Punishments')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_exceptions')
        .setLabel('Exceptions')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('automod_reset')
        .setLabel('Reset user')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function filterButtons(config) {
  const filters = config.filters;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_filter_blacklist')
        .setLabel(
          filters.blacklist.enabled
            ? 'Disable Blacklist'
            : 'Enable Blacklist',
        )
        .setStyle(
          filters.blacklist.enabled
            ? ButtonStyle.Danger
            : ButtonStyle.Success,
        ),

      new ButtonBuilder()
        .setCustomId('automod_words')
        .setLabel('Blacklist words')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_filter_spam')
        .setLabel(
          filters.spam.enabled
            ? 'Disable Spam'
            : 'Enable Spam',
        )
        .setStyle(
          filters.spam.enabled
            ? ButtonStyle.Danger
            : ButtonStyle.Success,
        ),

      new ButtonBuilder()
        .setCustomId('automod_filter_duplicates')
        .setLabel(
          filters.duplicates.enabled
            ? 'Disable Duplicates'
            : 'Enable Duplicates',
        )
        .setStyle(
          filters.duplicates.enabled
            ? ButtonStyle.Danger
            : ButtonStyle.Success,
        ),

      new ButtonBuilder()
        .setCustomId('automod_filter_invites')
        .setLabel(
          filters.invites.enabled
            ? 'Disable Invites'
            : 'Enable Invites',
        )
        .setStyle(
          filters.invites.enabled
            ? ButtonStyle.Danger
            : ButtonStyle.Success,
        ),
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_filter_links')
        .setLabel(
          filters.links.enabled
            ? 'Disable Links'
            : 'Enable Links',
        )
        .setStyle(
          filters.links.enabled
            ? ButtonStyle.Danger
            : ButtonStyle.Success,
        ),

      new ButtonBuilder()
        .setCustomId('automod_spam_settings')
        .setLabel('Spam settings')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_link_whitelist')
        .setLabel('Link whitelist')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_back')
        .setLabel('Back to dashboard')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function punishmentComponents(config, selectedLevel) {
  const levelOptions = [];

  for (let level = 1; level <= MAX_VIOLATION_LEVELS; level += 1) {
    levelOptions.push({
      label: `Violation ${level}`,
      value: String(level),
      description: displayPunishment(config.punishments[level - 1]),
      default: level === selectedLevel,
    });
  }

  const punishmentOptions = PUNISHMENT_CHOICES.map((choice) => ({
    ...choice,
    default: choice.value === config.punishments[selectedLevel - 1],
  }));

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('automod_select_level')
        .setPlaceholder('Choose an offence level')
        .addOptions(levelOptions),
    ),

    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('automod_select_punishment')
        .setPlaceholder('Choose the punishment')
        .addOptions(punishmentOptions),
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_back')
        .setLabel('Back to dashboard')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function exceptionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_channels')
        .setLabel('Ignored channels')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_roles')
        .setLabel('Ignored roles')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_users')
        .setLabel('Ignored users')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_back')
        .setLabel('Back to dashboard')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function createTextModal({
  customId,
  title,
  inputId,
  label,
  value = '',
  placeholder,
}) {
  const input = new TextInputBuilder()
    .setCustomId(inputId)
    .setLabel(label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder(placeholder);

  if (value) {
    input.setValue(value.slice(0, 4000));
  }

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function openTextModal({
  componentInteraction,
  modal,
  inputId,
  save,
  successMessage,
  render,
}) {
  await componentInteraction.showModal(modal);

  const submission = await componentInteraction.awaitModalSubmit({
    time: 5 * 60 * 1000,
    filter: (modalInteraction) =>
      modalInteraction.user.id === componentInteraction.user.id &&
      modalInteraction.customId === modal.toJSON().custom_id,
  }).catch(() => null);

  if (!submission) return;

  await submission.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    const value = submission.fields.getTextInputValue(inputId);

    await save(value);
    await render();
    await submission.editReply(successMessage);
  } catch (error) {
    logger.error('AutoMod modal save error:', error);

    await submission.editReply(
      'AutoMod could not save that setting. Check the bot logs for the exact error.',
    );
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure automatic moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dashboard')
        .setDescription('Open the AutoMod dashboard'),
    ),

  category: 'moderation',

  async execute(interaction) {
    const deferred = await InteractionHelper.safeDefer(interaction, {
      flags: MessageFlags.Ephemeral,
    });

    if (!deferred) return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return InteractionHelper.safeEditReply(interaction, {
        content: 'You need the Manage Server permission to use the AutoMod dashboard.',
      });
    }

    let view = 'main';
    let selectedLevel = 1;

    const buildPayload = async () => {
      const config = await getAutoModConfig(interaction.guildId);

      if (view === 'filters') {
        return {
          embeds: [buildDashboardEmbed(config, selectedLevel, 'filters')],
          components: filterButtons(config),
        };
      }

      if (view === 'punishments') {
        return {
          embeds: [buildDashboardEmbed(config, selectedLevel, 'punishments')],
          components: punishmentComponents(config, selectedLevel),
        };
      }

      if (view === 'exceptions') {
        return {
          embeds: [buildDashboardEmbed(config, selectedLevel, 'exceptions')],
          components: exceptionButtons(),
        };
      }

      return {
        embeds: [buildDashboardEmbed(config, selectedLevel, 'main')],
        components: mainButtons(config),
      };
    };

    const render = async () => {
      await interaction.editReply(await buildPayload());
    };

    await render();

    const dashboardMessage = await interaction.fetchReply();

    const collector = dashboardMessage.createMessageComponentCollector({
      time: 15 * 60 * 1000,
    });

    const handleComponent = async (componentInteraction) => {
      if (componentInteraction.user.id !== interaction.user.id) {
        await componentInteraction.reply({
          content: 'Run `/automod dashboard` to open your own dashboard.',
          flags: MessageFlags.Ephemeral,
        });

        return;
      }

      const config = await getAutoModConfig(interaction.guildId);

      if (componentInteraction.customId === 'automod_toggle') {
        await componentInteraction.deferUpdate();
        await setAutoModEnabled(interaction.guildId, !config.enabled);
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_filters') {
        await componentInteraction.deferUpdate();
        view = 'filters';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_punishments') {
        await componentInteraction.deferUpdate();
        view = 'punishments';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_exceptions') {
        await componentInteraction.deferUpdate();
        view = 'exceptions';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_back') {
        await componentInteraction.deferUpdate();
        view = 'main';
        await render();
        return;
      }

      if (componentInteraction.customId.startsWith('automod_filter_')) {
        const filterName = componentInteraction.customId.replace(
          'automod_filter_',
          '',
        );

        if (!Object.hasOwn(FILTER_LABELS, filterName)) {
          return;
        }

        await componentInteraction.deferUpdate();

        await setAutoModFilterEnabled(
          interaction.guildId,
          filterName,
          !config.filters[filterName].enabled,
        );

        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_words') {
        const modal = createTextModal({
          customId: `automod_words_${interaction.id}`,
          title: 'Blacklist words',
          inputId: 'words',
          label: 'Words or phrases, one per line',
          value: config.words.join('\n'),
          placeholder: 'spamword\nanother phrase\nthird word',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'words',
          render,
          save: async (value) => {
            await setAutoModWords(interaction.guildId, parseLines(value));
          },
          successMessage: 'The blacklist was updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_spam_settings') {
        const modal = createTextModal({
          customId: `automod_spam_settings_${interaction.id}`,
          title: 'Spam and duplicate settings',
          inputId: 'settings',
          label: 'One setting per line',
          value: [
            `messages=${config.filters.spam.maxMessages}`,
            `window=${config.filters.spam.windowSeconds}`,
            `duplicates=${config.filters.duplicates.maxDuplicates}`,
            `duplicate_window=${config.filters.duplicates.windowSeconds}`,
          ].join('\n'),
          placeholder: 'messages=6\nwindow=5\nduplicates=3\nduplicate_window=10',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'settings',
          render,
          save: async (value) => {
            const settings = parseNumberSettings(value);

            await updateAutoModConfig(interaction.guildId, {
              filters: {
                spam: {
                  maxMessages: settings.messages || config.filters.spam.maxMessages,
                  windowSeconds: settings.window || config.filters.spam.windowSeconds,
                },
                duplicates: {
                  maxDuplicates: settings.duplicates || config.filters.duplicates.maxDuplicates,
                  windowSeconds:
                    settings.duplicate_window ||
                    config.filters.duplicates.windowSeconds,
                },
              },
            });
          },
          successMessage: 'Spam and duplicate settings were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_link_whitelist') {
        const modal = createTextModal({
          customId: `automod_link_whitelist_${interaction.id}`,
          title: 'Link whitelist',
          inputId: 'domains',
          label: 'Allowed domains, one per line',
          value: config.filters.links.allowedDomains.join('\n'),
          placeholder: 'youtube.com\ntwitch.tv\nyourwebsite.com',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'domains',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              filters: {
                links: {
                  allowedDomains: parseLines(value),
                },
              },
            });
          },
          successMessage: 'The link whitelist was updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_select_level') {
        await componentInteraction.deferUpdate();
        selectedLevel = Number(componentInteraction.values[0]) || 1;
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_select_punishment') {
        const punishment = componentInteraction.values[0];

        await componentInteraction.deferUpdate();

        if (!VALID_PUNISHMENTS.has(punishment)) {
          return;
        }

        await setAutoModPunishment(
          interaction.guildId,
          selectedLevel,
          punishment,
        );

        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_channels') {
        const modal = createTextModal({
          customId: `automod_channels_${interaction.id}`,
          title: 'Ignored channels',
          inputId: 'channels',
          label: 'Channel IDs, one per line',
          value: config.ignoredChannelIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'channels',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredChannelIds: parseIds(value),
            });
          },
          successMessage: 'Ignored channels were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_roles') {
        const modal = createTextModal({
          customId: `automod_roles_${interaction.id}`,
          title: 'Ignored roles',
          inputId: 'roles',
          label: 'Role IDs, one per line',
          value: config.ignoredRoleIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'roles',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredRoleIds: parseIds(value),
            });
          },
          successMessage: 'Ignored roles were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_users') {
        const modal = createTextModal({
          customId: `automod_users_${interaction.id}`,
          title: 'Ignored users',
          inputId: 'users',
          label: 'User IDs, one per line',
          value: config.ignoredUserIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'users',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredUserIds: parseIds(value),
            });
          },
          successMessage: 'Ignored users were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_reset') {
        const modal = createTextModal({
          customId: `automod_reset_${interaction.id}`,
          title: 'Reset AutoMod violations',
          inputId: 'user_id',
          label: 'Discord user ID',
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'user_id',
          render,
          save: async (value) => {
            const userId = value.trim();

            if (!/^\d{15,25}$/.test(userId)) {
              throw new Error('Invalid Discord user ID');
            }

            await resetAutoModViolations(interaction.guildId, userId);
          },
          successMessage: 'That user’s AutoMod violation count was reset.',
        });
      }
    };

    collector.on('collect', (componentInteraction) => {
      void handleComponent(componentInteraction).catch(async (error) => {
        logger.error('AutoMod dashboard interaction error:', error);

        try {
          if (!componentInteraction.replied && !componentInteraction.deferred) {
            await componentInteraction.reply({
              content: 'Something went wrong while updating AutoMod.',
              flags: MessageFlags.Ephemeral,
            });
          } else {
            await componentInteraction.followUp({
              content: 'Something went wrong while updating AutoMod.',
              flags: MessageFlags.Ephemeral,
            });
          }
        } catch {
          // The original error is already in the bot log.
        }
      });
    });

    collector.on('end', () => {
      void interaction.editReply({
        components: [],
      }).catch(() => {});
    });
  },
};

/* import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
  MAX_VIOLATION_LEVELS,
  VALID_PUNISHMENTS,
  displayPunishment,
  getAutoModConfig,
  resetAutoModViolations,
  setAutoModEnabled,
  setAutoModFilterEnabled,
  setAutoModPunishment,
  setAutoModWords,
  updateAutoModConfig,
} from '../../services/automodService.js';

const PUNISHMENT_CHOICES = [
  { label: 'Delete message only', value: 'delete' },
  { label: 'Warn', value: 'warn' },
  { label: 'Timeout for 10 minutes', value: 'timeout_10m' },
  { label: 'Timeout for 1 hour', value: 'timeout_1h' },
  { label: 'Timeout for 1 day', value: 'timeout_1d' },
  { label: 'Kick', value: 'kick' },
  { label: 'Ban', value: 'ban' },
];

function parseLines(value) {
  return [...new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function parseIds(value) {
  return [...new Set(
    parseLines(value).filter((id) => /^\d{15,25}$/.test(id)),
  )];
}

function formatWords(words) {
  if (!words.length) return 'None';

  const visible = words.slice(0, 12);
  const remaining = words.length - visible.length;

  return remaining > 0
    ? `${visible.join(', ')} and ${remaining} more`
    : visible.join(', ');
}

function buildDashboardEmbed(config, selectedLevel = null) {
  const punishmentLines = config.punishments
    .map((punishment, index) => {
      const selected = selectedLevel === index + 1 ? 'Current: ' : '';
      return `Level ${index + 1}: ${selected}${displayPunishment(punishment)}`;
    })
    .join('\n');

  return createEmbed({
    title: 'AutoMod Dashboard',
    description: [
      `AutoMod: **${config.enabled ? 'Enabled' : 'Disabled'}**`,
      `Blacklist filter: **${config.filters.blacklist.enabled ? 'Enabled' : 'Disabled'}**`,
      `Blacklist words: **${config.words.length}**`,
      `Ignored channels: **${config.ignoredChannelIds.length}**`,
      `Ignored roles: **${config.ignoredRoleIds.length}**`,
      `Ignored users: **${config.ignoredUserIds.length}**`,
      '',
      'Blacklist preview:',
      formatWords(config.words),
      '',
      'Punishment ladder:',
      punishmentLines,
      '',
      'Messages matching a blacklisted word are always deleted first.',
      'From violation 11 onward, AutoMod keeps using level 10.',
    ].join('\n'),
    color: config.enabled ? 'primary' : 'warning',
  });
}

function mainButtons(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_toggle')
        .setLabel(config.enabled ? 'Disable AutoMod' : 'Enable AutoMod')
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('automod_blacklist_toggle')
        .setLabel(
          config.filters.blacklist.enabled
            ? 'Disable Blacklist'
            : 'Enable Blacklist',
        )
        .setStyle(
          config.filters.blacklist.enabled
            ? ButtonStyle.Danger
            : ButtonStyle.Success,
        ),

      new ButtonBuilder()
        .setCustomId('automod_words')
        .setLabel('Blacklist words')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_punishments')
        .setLabel('Punishments')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_exceptions')
        .setLabel('Exceptions')
        .setStyle(ButtonStyle.Secondary),
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_reset')
        .setLabel('Reset user')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function punishmentComponents(config, selectedLevel) {
  const levelOptions = [];

  for (let level = 1; level <= MAX_VIOLATION_LEVELS; level += 1) {
    levelOptions.push({
      label: `Violation ${level}`,
      value: String(level),
      description: displayPunishment(config.punishments[level - 1]),
      default: level === selectedLevel,
    });
  }

  const punishmentOptions = PUNISHMENT_CHOICES.map((choice) => ({
    ...choice,
    default: choice.value === config.punishments[selectedLevel - 1],
  }));

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('automod_select_level')
        .setPlaceholder('Choose an offence level')
        .addOptions(levelOptions),
    ),

    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('automod_select_punishment')
        .setPlaceholder('Choose the punishment')
        .addOptions(punishmentOptions),
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_back')
        .setLabel('Back to dashboard')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function exceptionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_channels')
        .setLabel('Ignored channels')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_roles')
        .setLabel('Ignored roles')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_users')
        .setLabel('Ignored users')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_back')
        .setLabel('Back to dashboard')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function createTextModal({
  customId,
  title,
  inputId,
  label,
  value = '',
  placeholder,
}) {
  const input = new TextInputBuilder()
    .setCustomId(inputId)
    .setLabel(label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder(placeholder);

  if (value) {
    input.setValue(value.slice(0, 4000));
  }

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function openTextModal({
  componentInteraction,
  modal,
  inputId,
  save,
  successMessage,
  render,
}) {
  await componentInteraction.showModal(modal);

  const submission = await componentInteraction.awaitModalSubmit({
    time: 5 * 60 * 1000,
    filter: (modalInteraction) =>
      modalInteraction.user.id === componentInteraction.user.id &&
      modalInteraction.customId === modal.toJSON().custom_id,
  }).catch(() => null);

  if (!submission) return;

  await submission.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    const value = submission.fields.getTextInputValue(inputId);

    await save(value);
    await render();

    await submission.editReply(successMessage);
  } catch (error) {
    logger.error('AutoMod modal save error:', error);

    await submission.editReply(
      'AutoMod could not save that setting. Check the bot logs for the exact error.',
    );
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure automatic moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dashboard')
        .setDescription('Open the AutoMod dashboard'),
    ),

  category: 'moderation',

  async execute(interaction) {
    const deferred = await InteractionHelper.safeDefer(interaction, {
      flags: MessageFlags.Ephemeral,
    });

    if (!deferred) return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return InteractionHelper.safeEditReply(interaction, {
        content: 'You need the Manage Server permission to use the AutoMod dashboard.',
      });
    }

    let view = 'main';
    let selectedLevel = 1;

    const buildPayload = async () => {
      const config = await getAutoModConfig(interaction.guildId);

      if (view === 'punishments') {
        return {
          embeds: [buildDashboardEmbed(config, selectedLevel)],
          components: punishmentComponents(config, selectedLevel),
        };
      }

      if (view === 'exceptions') {
        return {
          embeds: [buildDashboardEmbed(config)],
          components: exceptionButtons(),
        };
      }

      return {
        embeds: [buildDashboardEmbed(config)],
        components: mainButtons(config),
      };
    };

    const render = async () => {
      await interaction.editReply(await buildPayload());
    };

    await render();

    const dashboardMessage = await interaction.fetchReply();

    const collector = dashboardMessage.createMessageComponentCollector({
      time: 15 * 60 * 1000,
    });

    const handleComponent = async (componentInteraction) => {
      if (componentInteraction.user.id !== interaction.user.id) {
        await componentInteraction.reply({
          content: 'Run `/automod dashboard` to open your own dashboard.',
          flags: MessageFlags.Ephemeral,
        });

        return;
      }

      const config = await getAutoModConfig(interaction.guildId);

      if (componentInteraction.customId === 'automod_toggle') {
        await componentInteraction.deferUpdate();
        await setAutoModEnabled(interaction.guildId, !config.enabled);
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_blacklist_toggle') {
        await componentInteraction.deferUpdate();

        await setAutoModFilterEnabled(
          interaction.guildId,
          'blacklist',
          !config.filters.blacklist.enabled,
        );

        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_words') {
        const modal = createTextModal({
          customId: `automod_words_${interaction.id}`,
          title: 'Blacklist words',
          inputId: 'words',
          label: 'Words or phrases, one per line',
          value: config.words.join('\n'),
          placeholder: 'spamword\nanother phrase\nthird word',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'words',
          render,
          save: async (value) => {
            await setAutoModWords(interaction.guildId, parseLines(value));
          },
          successMessage: 'The blacklist was updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_punishments') {
        await componentInteraction.deferUpdate();
        view = 'punishments';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_exceptions') {
        await componentInteraction.deferUpdate();
        view = 'exceptions';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_back') {
        await componentInteraction.deferUpdate();
        view = 'main';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_select_level') {
        await componentInteraction.deferUpdate();
        selectedLevel = Number(componentInteraction.values[0]) || 1;
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_select_punishment') {
        const punishment = componentInteraction.values[0];

        await componentInteraction.deferUpdate();

        if (!VALID_PUNISHMENTS.has(punishment)) {
          return;
        }

        await setAutoModPunishment(
          interaction.guildId,
          selectedLevel,
          punishment,
        );

        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_channels') {
        const modal = createTextModal({
          customId: `automod_channels_${interaction.id}`,
          title: 'Ignored channels',
          inputId: 'channels',
          label: 'Channel IDs, one per line',
          value: config.ignoredChannelIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'channels',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredChannelIds: parseIds(value),
            });
          },
          successMessage: 'Ignored channels were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_roles') {
        const modal = createTextModal({
          customId: `automod_roles_${interaction.id}`,
          title: 'Ignored roles',
          inputId: 'roles',
          label: 'Role IDs, one per line',
          value: config.ignoredRoleIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'roles',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredRoleIds: parseIds(value),
            });
          },
          successMessage: 'Ignored roles were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_users') {
        const modal = createTextModal({
          customId: `automod_users_${interaction.id}`,
          title: 'Ignored users',
          inputId: 'users',
          label: 'User IDs, one per line',
          value: config.ignoredUserIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'users',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredUserIds: parseIds(value),
            });
          },
          successMessage: 'Ignored users were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_reset') {
        const modal = createTextModal({
          customId: `automod_reset_${interaction.id}`,
          title: 'Reset AutoMod violations',
          inputId: 'user_id',
          label: 'Discord user ID',
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'user_id',
          render,
          save: async (value) => {
            const userId = value.trim();

            if (!/^\d{15,25}$/.test(userId)) {
              throw new Error('Invalid Discord user ID');
            }

            await resetAutoModViolations(interaction.guildId, userId);
          },
          successMessage: 'That user’s AutoMod violation count was reset.',
        });
      }
    };

    collector.on('collect', (componentInteraction) => {
      void handleComponent(componentInteraction).catch(async (error) => {
        logger.error('AutoMod dashboard interaction error:', error);

        try {
          if (!componentInteraction.replied && !componentInteraction.deferred) {
            await componentInteraction.reply({
              content: 'Something went wrong while updating AutoMod.',
              flags: MessageFlags.Ephemeral,
            });
          } else {
            await componentInteraction.followUp({
              content: 'Something went wrong while updating AutoMod.',
              flags: MessageFlags.Ephemeral,
            });
          }
        } catch {
          // Error is already logged.
        }
      });
    });

    collector.on('end', () => {
      void interaction.editReply({
        components: [],
      }).catch(() => {});
    });
  },
};
*/
/* 
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
  MAX_VIOLATION_LEVELS,
  VALID_PUNISHMENTS,
  displayPunishment,
  getAutoModConfig,
  resetAutoModViolations,
  setAutoModEnabled,
  setAutoModPunishment,
  setAutoModWords,
  updateAutoModConfig,
} from '../../services/automodService.js';

const PUNISHMENT_CHOICES = [
  { label: 'Delete message only', value: 'delete' },
  { label: 'Warn', value: 'warn' },
  { label: 'Timeout for 10 minutes', value: 'timeout_10m' },
  { label: 'Timeout for 1 hour', value: 'timeout_1h' },
  { label: 'Timeout for 1 day', value: 'timeout_1d' },
  { label: 'Kick', value: 'kick' },
  { label: 'Ban', value: 'ban' },
];

function parseLines(value) {
  return [...new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function parseIds(value) {
  return [...new Set(
    parseLines(value).filter((id) => /^\d{15,25}$/.test(id)),
  )];
}

function formatWords(words) {
  if (!words.length) return 'None';

  const visible = words.slice(0, 12);
  const extra = words.length - visible.length;

  return extra > 0
    ? `${visible.join(', ')} and ${extra} more`
    : visible.join(', ');
}

function buildDashboardEmbed(config, selectedLevel = null) {
  const punishmentLines = config.punishments
    .map((punishment, index) => {
      const prefix = selectedLevel === index + 1 ? 'Current: ' : '';
      return `Level ${index + 1}: ${prefix}${displayPunishment(punishment)}`;
    })
    .join('\n');

  return createEmbed({
    title: 'AutoMod Dashboard',
    description: [
      `Status: **${config.enabled ? 'Enabled' : 'Disabled'}**`,
      `Blacklist words: **${config.words.length}**`,
      `Ignored channels: **${config.ignoredChannelIds.length}**`,
      `Ignored roles: **${config.ignoredRoleIds.length}**`,
      `Ignored users: **${config.ignoredUserIds.length}**`,
      '',
      'Blacklist preview:',
      formatWords(config.words),
      '',
      'Punishment ladder:',
      punishmentLines,
      '',
      'Messages matching a blacklisted word are always deleted first.',
      'From violation 6 onward, AutoMod uses level 5.',
    ].join('\n'),
    color: config.enabled ? 'primary' : 'warning',
  });
}

function mainButtons(config) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_toggle')
        .setLabel(config.enabled ? 'Disable AutoMod' : 'Enable AutoMod')
        .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId('automod_words')
        .setLabel('Blacklist words')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_punishments')
        .setLabel('Punishments')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_exceptions')
        .setLabel('Exceptions')
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId('automod_reset')
        .setLabel('Reset user')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function punishmentComponents(config, selectedLevel) {
  const levelOptions = [];

  for (let level = 1; level <= MAX_VIOLATION_LEVELS; level += 1) {
    levelOptions.push({
      label: `Violation ${level}`,
      value: String(level),
      description: displayPunishment(config.punishments[level - 1]),
      default: level === selectedLevel,
    });
  }

  const punishmentOptions = PUNISHMENT_CHOICES.map((choice) => ({
    ...choice,
    default: choice.value === config.punishments[selectedLevel - 1],
  }));

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('automod_select_level')
        .setPlaceholder('Choose an offence level')
        .addOptions(levelOptions),
    ),

    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('automod_select_punishment')
        .setPlaceholder('Choose the punishment')
        .addOptions(punishmentOptions),
    ),

    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_back')
        .setLabel('Back to dashboard')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function exceptionButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('automod_channels')
        .setLabel('Ignored channels')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_roles')
        .setLabel('Ignored roles')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_users')
        .setLabel('Ignored users')
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId('automod_back')
        .setLabel('Back to dashboard')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function createTextModal({
  customId,
  title,
  inputId,
  label,
  value = '',
  placeholder,
}) {
  const input = new TextInputBuilder()
    .setCustomId(inputId)
    .setLabel(label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder(placeholder);

  if (value) {
    input.setValue(value.slice(0, 4000));
  }

  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function openTextModal({
  componentInteraction,
  modal,
  inputId,
  save,
  successMessage,
  render,
}) {
  await componentInteraction.showModal(modal);

  const submission = await componentInteraction.awaitModalSubmit({
    time: 5 * 60 * 1000,
    filter: (modalInteraction) =>
      modalInteraction.user.id === componentInteraction.user.id &&
      modalInteraction.customId === modal.toJSON().custom_id,
  }).catch(() => null);

  if (!submission) return;

  await submission.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    const value = submission.fields.getTextInputValue(inputId);

    await save(value);
    await render();

    await submission.editReply(successMessage);
  } catch (error) {
    logger.error('AutoMod modal save error:', error);

    await submission.editReply(
      'AutoMod could not save that setting. Check the bot logs for the exact error.',
    );
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure automatic moderation')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('dashboard')
        .setDescription('Open the AutoMod dashboard'),
    ),

  category: 'moderation',

  async execute(interaction) {
    const deferred = await InteractionHelper.safeDefer(interaction, {
      flags: MessageFlags.Ephemeral,
    });

    if (!deferred) return;

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return InteractionHelper.safeEditReply(interaction, {
        content: 'You need the Manage Server permission to use the AutoMod dashboard.',
      });
    }

    let view = 'main';
    let selectedLevel = 1;

    const buildPayload = async () => {
      const config = await getAutoModConfig(interaction.guildId);

      if (view === 'punishments') {
        return {
          embeds: [buildDashboardEmbed(config, selectedLevel)],
          components: punishmentComponents(config, selectedLevel),
        };
      }

      if (view === 'exceptions') {
        return {
          embeds: [buildDashboardEmbed(config)],
          components: exceptionButtons(),
        };
      }

      return {
        embeds: [buildDashboardEmbed(config)],
        components: mainButtons(config),
      };
    };

    const render = async () => {
      const payload = await buildPayload();

      // Gebruik de originele interaction in plaats van dashboardMessage.edit().
      // Dit werkt betrouwbaar voor ephemeral dashboards.
      await interaction.editReply(payload);
    };

    await render();

    // fetchReply geeft een echt Message-object waarmee de collector werkt.
    const dashboardMessage = await interaction.fetchReply();

    const collector = dashboardMessage.createMessageComponentCollector({
      time: 15 * 60 * 1000,
    });

    const handleComponent = async (componentInteraction) => {
      if (componentInteraction.user.id !== interaction.user.id) {
        await componentInteraction.reply({
          content: 'Run `/automod dashboard` to open your own dashboard.',
          flags: MessageFlags.Ephemeral,
        });

        return;
      }

      const config = await getAutoModConfig(interaction.guildId);

      if (componentInteraction.customId === 'automod_toggle') {
        await componentInteraction.deferUpdate();
        await setAutoModEnabled(interaction.guildId, !config.enabled);
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_words') {
        const modal = createTextModal({
          customId: `automod_words_${interaction.id}`,
          title: 'Blacklist words',
          inputId: 'words',
          label: 'Words or phrases, one per line',
          value: config.words.join('\n'),
          placeholder: 'spamword\nanother phrase\nthird word',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'words',
          render,
          save: async (value) => {
            await setAutoModWords(interaction.guildId, parseLines(value));
          },
          successMessage: 'The blacklist was updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_punishments') {
        await componentInteraction.deferUpdate();
        view = 'punishments';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_exceptions') {
        await componentInteraction.deferUpdate();
        view = 'exceptions';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_back') {
        await componentInteraction.deferUpdate();
        view = 'main';
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_select_level') {
        await componentInteraction.deferUpdate();
        selectedLevel = Number(componentInteraction.values[0]) || 1;
        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_select_punishment') {
        const punishment = componentInteraction.values[0];

        await componentInteraction.deferUpdate();

        if (!VALID_PUNISHMENTS.has(punishment)) {
          return;
        }

        await setAutoModPunishment(
          interaction.guildId,
          selectedLevel,
          punishment,
        );

        await render();
        return;
      }

      if (componentInteraction.customId === 'automod_channels') {
        const modal = createTextModal({
          customId: `automod_channels_${interaction.id}`,
          title: 'Ignored channels',
          inputId: 'channels',
          label: 'Channel IDs, one per line',
          value: config.ignoredChannelIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'channels',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredChannelIds: parseIds(value),
            });
          },
          successMessage: 'Ignored channels were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_roles') {
        const modal = createTextModal({
          customId: `automod_roles_${interaction.id}`,
          title: 'Ignored roles',
          inputId: 'roles',
          label: 'Role IDs, one per line',
          value: config.ignoredRoleIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'roles',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredRoleIds: parseIds(value),
            });
          },
          successMessage: 'Ignored roles were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_users') {
        const modal = createTextModal({
          customId: `automod_users_${interaction.id}`,
          title: 'Ignored users',
          inputId: 'users',
          label: 'User IDs, one per line',
          value: config.ignoredUserIds.join('\n'),
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'users',
          render,
          save: async (value) => {
            await updateAutoModConfig(interaction.guildId, {
              ignoredUserIds: parseIds(value),
            });
          },
          successMessage: 'Ignored users were updated.',
        });

        return;
      }

      if (componentInteraction.customId === 'automod_reset') {
        const modal = createTextModal({
          customId: `automod_reset_${interaction.id}`,
          title: 'Reset AutoMod violations',
          inputId: 'user_id',
          label: 'Discord user ID',
          placeholder: '123456789012345678',
        });

        await openTextModal({
          componentInteraction,
          modal,
          inputId: 'user_id',
          render,
          save: async (value) => {
            const userId = value.trim();

            if (!/^\d{15,25}$/.test(userId)) {
              throw new Error('Invalid Discord user ID');
            }

            await resetAutoModViolations(interaction.guildId, userId);
          },
          successMessage: 'That user’s AutoMod violation count was reset.',
        });
      }
    };

    collector.on('collect', (componentInteraction) => {
      void handleComponent(componentInteraction).catch(async (error) => {
        logger.error('AutoMod dashboard interaction error:', error);

        try {
          if (!componentInteraction.replied && !componentInteraction.deferred) {
            await componentInteraction.reply({
              content: 'Something went wrong while updating AutoMod.',
              flags: MessageFlags.Ephemeral,
            });
          } else {
            await componentInteraction.followUp({
              content: 'Something went wrong while updating AutoMod.',
              flags: MessageFlags.Ephemeral,
            });
          }
        } catch {
          // De fout is al naar de serverlog geschreven.
        }
      });
    });

    collector.on('end', () => {
      void interaction.editReply({
        components: [],
      }).catch(() => {});
    });
  },
};
*/
