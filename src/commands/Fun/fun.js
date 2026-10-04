import { SlashCommandBuilder } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const FAMILY_PREFIX = 'temp:family';
const EVENT_CHANCE = 0.25;
const MAX_FAKE_BABIES = 5;

const COOLDOWNS = {
  marry: 5 * 60 * 1000,
  divorce: 3 * 60 * 1000,
  adopt: 1 * 30 * 10,
  disown: 15 * 60 * 1000,
  baby: 24 * 60 * 60 * 1000,
  hug: 30 * 1000,
  kiss: 30 * 1000,
  protect: 30 * 1000,
  tease: 30 * 1000,
};

const RANDOM_EVENTS = [
  'A mysterious frog joined the family. Nobody knows who invited it.',
  'The family found 50 cookies under the sofa.',
  'Someone posted an embarrassing family photo.',
  'Family dinner became an argument about pineapple on pizza.',
  'The family dog has chosen a new favourite person.',
  'A neighbour complained about the family being too loud.',
  'Someone accidentally created a very awkward family group chat.',
];

const SOCIAL_ACTIONS = {
  hug: {
    verb: 'hugged',
    text: 'A family hug was recorded for legal reasons.',
  },
  kiss: {
    verb: 'gave a kiss to',
    text: 'The family group chat became slightly uncomfortable.',
  },
  protect: {
    verb: 'protected',
    text: 'The danger was probably imaginary, but the protection was real.',
  },
  tease: {
    verb: 'teased',
    text: 'This will definitely be remembered at family dinner.',
  },
};

function familyKey(guildId, userId) {
  return `${FAMILY_PREFIX}:${guildId}:${userId}`;
}

function emptyFamily() {
  return {
    partnerId: null,
    parentIds: [],
    childIds: [],
    virtualChildren: [],
    cooldowns: {},
    createdAt: Date.now(),
  };
}

function normalizeFamily(record) {
  const value = record && typeof record === 'object' ? record : emptyFamily();

  return {
    partnerId: value.partnerId || null,
    parentIds: [...new Set(Array.isArray(value.parentIds) ? value.parentIds.filter(Boolean) : [])],
    childIds: [...new Set(Array.isArray(value.childIds) ? value.childIds.filter(Boolean) : [])],
    virtualChildren: Array.isArray(value.virtualChildren) ? value.virtualChildren : [],
    cooldowns: value.cooldowns && typeof value.cooldowns === 'object' ? value.cooldowns : {},
    createdAt: value.createdAt || Date.now(),
  };
}

async function getFamily(db, guildId, userId) {
  return normalizeFamily(await db.get(familyKey(guildId, userId), null));
}

async function saveFamily(db, guildId, userId, record) {
  await db.set(familyKey(guildId, userId), normalizeFamily(record));
}

function removeId(list, userId) {
  return list.filter((id) => id !== userId);
}

function mention(userId) {
  return `<@${userId}>`;
}

function mentionList(ids, emptyText = 'None') {
  if (!ids.length) return emptyText;

  const visible = ids.slice(0, 10).map(mention);
  const remaining = ids.length - visible.length;

  return remaining > 0
    ? `${visible.join(', ')} and ${remaining} more`
    : visible.join(', ');
}

function babyList(babies) {
  if (!babies.length) return 'None';

  const names = babies.slice(0, 10).map((baby) => baby.name);
  const remaining = babies.length - names.length;

  return remaining > 0
    ? `${names.join(', ')} and ${remaining} more`
    : names.join(', ');
}

function formatTime(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (seconds === 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'}`;
}

function cooldownRemaining(record, action) {
  const lastUsed = Number(record.cooldowns?.[action] || 0);
  const cooldown = COOLDOWNS[action] || 0;
  const remaining = lastUsed + cooldown - Date.now();

  return remaining > 0 ? remaining : 0;
}

function useCooldown(record, action) {
  record.cooldowns[action] = Date.now();
}

function randomEvent() {
  if (Math.random() > EVENT_CHANCE) return null;

  return RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
}

function addRandomEvent(text) {
  const event = randomEvent();
  return event ? `${text}\n\nRandom family event: ${event}` : text;
}

async function reply(interaction, description) {
  return InteractionHelper.safeEditReply(interaction, {
    embeds: [
      createEmbed({
        title: 'Family',
        description,
        color: 'primary',
      }),
    ],
  });
}

async function isAncestor(db, guildId, possibleAncestorId, userId, visited = new Set()) {
  if (possibleAncestorId === userId || visited.has(userId)) {
    return false;
  }

  visited.add(userId);

  const record = await getFamily(db, guildId, userId);

  for (const parentId of record.parentIds) {
    if (parentId === possibleAncestorId) {
      return true;
    }

    if (await isAncestor(db, guildId, possibleAncestorId, parentId, visited)) {
      return true;
    }
  }

  return false;
}

async function areBloodRelated(db, guildId, firstId, secondId) {
  const [first, second] = await Promise.all([
    getFamily(db, guildId, firstId),
    getFamily(db, guildId, secondId),
  ]);

  const sharedParent = first.parentIds.some((parentId) => second.parentIds.includes(parentId));

  if (
    first.parentIds.includes(secondId) ||
    second.parentIds.includes(firstId) ||
    sharedParent
  ) {
    return true;
  }

  if (await isAncestor(db, guildId, firstId, secondId)) {
    return true;
  }

  return isAncestor(db, guildId, secondId, firstId);
}

function targetError(interaction, target, action) {
  if (!target) return 'Please choose a user.';
  if (target.id === interaction.user.id) return `You cannot ${action} yourself. Nice try.`;
  if (target.bot) return `You cannot ${action} a bot.`;
  return null;
}

async function handleMarry(interaction, db) {
  const target = interaction.options.getUser('user');
  const error = targetError(interaction, target, 'marry');

  if (error) return reply(interaction, error);

  const [authorFamily, targetFamily] = await Promise.all([
    getFamily(db, interaction.guildId, interaction.user.id),
    getFamily(db, interaction.guildId, target.id),
  ]);

  const remaining = cooldownRemaining(authorFamily, 'marry');

  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before getting married again.`);
  }

  if (authorFamily.partnerId) {
    return reply(interaction, 'You are already married. Handle that situation before starting another one.');
  }

  if (targetFamily.partnerId) {
    return reply(interaction, 'That user is already married.');
  }

  if (await areBloodRelated(db, interaction.guildId, interaction.user.id, target.id)) {
    return reply(interaction, 'You cannot marry a parent, child, sibling, or other blood relative.');
  }

  authorFamily.partnerId = target.id;
  targetFamily.partnerId = interaction.user.id;
  useCooldown(authorFamily, 'marry');

  await Promise.all([
    saveFamily(db, interaction.guildId, interaction.user.id, authorFamily),
    saveFamily(db, interaction.guildId, target.id, targetFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} married ${mention(target.id)} without asking.\nSomehow, it worked.`),
  );
}

async function handleDivorce(interaction, db) {
  const authorFamily = await getFamily(db, interaction.guildId, interaction.user.id);

  const remaining = cooldownRemaining(authorFamily, 'divorce');

  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before divorcing again.`);
  }

  if (!authorFamily.partnerId) {
    return reply(interaction, 'You are not married.');
  }

  const partnerId = authorFamily.partnerId;
  const partnerFamily = await getFamily(db, interaction.guildId, partnerId);

  authorFamily.partnerId = null;

  if (partnerFamily.partnerId === interaction.user.id) {
    partnerFamily.partnerId = null;
  }

  useCooldown(authorFamily, 'divorce');

  await Promise.all([
    saveFamily(db, interaction.guildId, interaction.user.id, authorFamily),
    saveFamily(db, interaction.guildId, partnerId, partnerFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} divorced ${mention(partnerId)}.\nThe family group chat is now awkward.`),
  );
}

async function handleAdopt(interaction, db) {
  const target = interaction.options.getUser('user');
  const error = targetError(interaction, target, 'adopt');

  if (error) return reply(interaction, error);

  const [authorFamily, targetFamily] = await Promise.all([
    getFamily(db, interaction.guildId, interaction.user.id),
    getFamily(db, interaction.guildId, target.id),
  ]);

  const remaining = cooldownRemaining(authorFamily, 'adopt');

  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before adopting another person.`);
  }

  if (authorFamily.partnerId === target.id || targetFamily.partnerId === interaction.user.id) {
    return reply(interaction, 'You cannot adopt your spouse. The family paperwork refuses to continue.');
  }

  if (targetFamily.parentIds.includes(interaction.user.id)) {
    return reply(interaction, 'That user is already your child.');
  }

  if (targetFamily.parentIds.length >= 2) {
    return reply(interaction, 'That user already has two parents.');
  }

  if (await areBloodRelated(db, interaction.guildId, interaction.user.id, target.id)) {
    return reply(interaction, 'You cannot adopt someone who is already part of your blood family.');
  }

  authorFamily.childIds.push(target.id);
  targetFamily.parentIds.push(interaction.user.id);
  useCooldown(authorFamily, 'adopt');

  await Promise.all([
    saveFamily(db, interaction.guildId, interaction.user.id, authorFamily),
    saveFamily(db, interaction.guildId, target.id, targetFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} adopted ${mention(target.id)}.\nWelcome to the family, kiddo.`),
  );
}

async function handleDisown(interaction, db) {
  const target = interaction.options.getUser('user');
  const error = targetError(interaction, target, 'disown');

  if (error) return reply(interaction, error);

  const [authorFamily, targetFamily] = await Promise.all([
    getFamily(db, interaction.guildId, interaction.user.id),
    getFamily(db, interaction.guildId, target.id),
  ]);

  const remaining = cooldownRemaining(authorFamily, 'disown');

  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before disowning someone again.`);
  }

  if (authorFamily.childIds.includes(target.id)) {
    authorFamily.childIds = removeId(authorFamily.childIds, target.id);
    targetFamily.parentIds = removeId(targetFamily.parentIds, interaction.user.id);
  } else if (authorFamily.parentIds.includes(target.id)) {
    authorFamily.parentIds = removeId(authorFamily.parentIds, target.id);
    targetFamily.childIds = removeId(targetFamily.childIds, interaction.user.id);
  } else {
    return reply(interaction, 'That user is not your direct parent or child.');
  }

  useCooldown(authorFamily, 'disown');

  await Promise.all([
    saveFamily(db, interaction.guildId, interaction.user.id, authorFamily),
    saveFamily(db, interaction.guildId, target.id, targetFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} has disowned ${mention(target.id)}.\nYou are no longer invited to Family Dinner.`),
  );
}

async function handleBaby(interaction, db) {
  const name = interaction.options.getString('name', true).trim();
  const authorId = interaction.user.id;
  const authorFamily = await getFamily(db, interaction.guildId, authorId);

  if (!authorFamily.partnerId) {
    return reply(interaction, 'You need a partner before you can have a baby.');
  }

  const partnerId = authorFamily.partnerId;
  const partnerFamily = await getFamily(db, interaction.guildId, partnerId);

  if (partnerFamily.partnerId !== authorId) {
    return reply(interaction, 'Your family data is confused. Try marrying your partner again first.');
  }

  const remaining = cooldownRemaining(authorFamily, 'baby');

  if (remaining) {
    return reply(
      interaction,
      `You must wait ${formatTime(remaining)} before having another baby.`,
    );
  }

  if (authorFamily.virtualChildren.length >= MAX_FAKE_BABIES) {
    return reply(interaction, `Your family already has the maximum of ${MAX_FAKE_BABIES} fake babies.`);
  }

  const safeName = name.replace(/@/g, '@\u200B');

  const baby = {
    id: randomUUID(),
    name: safeName,
    createdAt: Date.now(),
  };

  authorFamily.virtualChildren.push(baby);
  partnerFamily.virtualChildren.push(baby);

  useCooldown(authorFamily, 'baby');
  partnerFamily.cooldowns.baby = authorFamily.cooldowns.baby;

  await Promise.all([
    saveFamily(db, interaction.guildId, authorId, authorFamily),
    saveFamily(db, interaction.guildId, partnerId, partnerFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(
      `${mention(authorId)} and ${mention(partnerId)} welcomed a new fake baby named **${safeName}**.\nNobody is sure who approved this.`,
    ),
  );
}

async function handleProfile(interaction, db, showTree = false) {
  const target = interaction.options.getUser('user') || interaction.user;

  if (target.bot) {
    return reply(interaction, 'Bots do not have a family profile.');
  }

  const family = await getFamily(db, interaction.guildId, target.id);

  const description = [
    `Family profile for ${mention(target.id)}`,
    '',
    `Partner: ${family.partnerId ? mention(family.partnerId) : 'None'}`,
    `Parents: ${mentionList(family.parentIds)}`,
    `Children: ${mentionList(family.childIds)}`,
    `Fake babies: ${babyList(family.virtualChildren)}`,
  ];

  if (showTree) {
    const siblings = [];

    for (const parentId of family.parentIds) {
      const parent = await getFamily(db, interaction.guildId, parentId);

      for (const childId of parent.childIds) {
        if (childId !== target.id && !siblings.includes(childId)) {
          siblings.push(childId);
        }
      }
    }

    description.push(`Siblings: ${mentionList(siblings)}`);
  }

  return reply(interaction, description.join('\n'));
}

async function handleSocialAction(interaction, db, action) {
  const target = interaction.options.getUser('user');
  const error = targetError(interaction, target, action);

  if (error) return reply(interaction, error);

  const authorFamily = await getFamily(db, interaction.guildId, interaction.user.id);
  const remaining = cooldownRemaining(authorFamily, action);

  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before using this action again.`);
  }

  useCooldown(authorFamily, action);
  await saveFamily(db, interaction.guildId, interaction.user.id, authorFamily);

  const socialAction = SOCIAL_ACTIONS[action];

  return reply(
    interaction,
    addRandomEvent(
      `${mention(interaction.user.id)} ${socialAction.verb} ${mention(target.id)}.\n${socialAction.text}`,
    ),
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('fun')
    .setDescription('Fun commands')
    .setDMPermission(false)
    .addSubcommandGroup((group) =>
      group
        .setName('family')
        .setDescription('Family actions')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('marry')
            .setDescription('Marry someone instantly')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to marry').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('divorce')
            .setDescription('Divorce your current partner'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('adopt')
            .setDescription('Adopt someone instantly')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to adopt').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('disown')
            .setDescription('Disown a direct parent or child')
            .addUserOption((option) =>
              option.setName('user').setDescription('The family member to disown').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('baby')
            .setDescription('Have a baby with your partner')
            .addStringOption((option) =>
              option
                .setName('name')
                .setDescription('The name of the (fake) baby')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(32),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('profile')
            .setDescription('View a family profile')
            .addUserOption((option) =>
              option.setName('user').setDescription('The user to view'),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('tree')
            .setDescription('View a family tree')
            .addUserOption((option) =>
              option.setName('user').setDescription('The user to view'),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('hug')
            .setDescription('Hug someone')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to hug').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('kiss')
            .setDescription('Give someone a kiss')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to kiss').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('protect')
            .setDescription('Protect someone')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to protect').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('tease')
            .setDescription('Tease someone')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to tease').setRequired(true),
            ),
        ),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    if (!interaction.inGuild()) {
      return reply(interaction, 'This command can only be used in a server.');
    }

    const db = interaction.client.db;

    if (!db) {
      return reply(interaction, 'The family system is not available right now.');
    }

    const group = interaction.options.getSubcommandGroup(false);
    const action = interaction.options.getSubcommand();

    if (group !== 'family') {
      return reply(interaction, 'Please choose a family action.');
    }

    try {
      if (action === 'marry') return handleMarry(interaction, db);
      if (action === 'divorce') return handleDivorce(interaction, db);
      if (action === 'adopt') return handleAdopt(interaction, db);
      if (action === 'disown') return handleDisown(interaction, db);
      if (action === 'baby') return handleBaby(interaction, db);
      if (action === 'profile') return handleProfile(interaction, db);
      if (action === 'tree') return handleProfile(interaction, db, true);
      if (SOCIAL_ACTIONS[action]) return handleSocialAction(interaction, db, action);

      return reply(interaction, 'Please choose a valid family action.');
    } catch (error) {
      console.error('Family command error:', error);
      return reply(interaction, 'Something went wrong while updating the family.');
    }
  },
};


/*
import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const FAMILY_PREFIX = 'temp:family';
const EVENT_CHANCE = 0.25;

const COOLDOWNS = {
  marry: 60 * 60 * 1000,
  divorce: 30 * 60 * 1000,
  adopt: 10 * 60 * 1000,
  disown: 15 * 60 * 1000,
  hug: 30 * 1000,
  kiss: 30 * 1000,
  protect: 30 * 1000,
  tease: 30 * 1000,
};

const RANDOM_EVENTS = [
  'A mysterious frog joined the family. Nobody knows who invited it.',
  'The family found 50 cookies under the sofa.',
  'Someone posted an embarrassing family photo.',
  'Family dinner became an argument about pineapple on pizza.',
  'The family dog has chosen a new favourite person.',
  'A neighbour complained about the family being too loud.',
  'Someone accidentally created a very awkward family group chat.',
];

const SOCIAL_ACTIONS = {
  hug: {
    verb: 'hugged',
    text: 'A family hug was recorded for legal reasons.',
  },
  kiss: {
    verb: 'gave a kiss to',
    text: 'The family group chat became slightly uncomfortable.',
  },
  protect: {
    verb: 'protected',
    text: 'The danger was probably imaginary, but the protection was real.',
  },
  tease: {
    verb: 'teased',
    text: 'This will definitely be remembered at family dinner.',
  },
};

function familyKey(guildId, userId) {
  return `${FAMILY_PREFIX}:${guildId}:${userId}`;
}

function emptyFamily() {
  return {
    partnerId: null,
    parentIds: [],
    childIds: [],
    cooldowns: {},
    createdAt: Date.now(),
  };
}

function normalizeFamily(record) {
  const value = record && typeof record === 'object' ? record : emptyFamily();

  return {
    partnerId: value.partnerId || null,
    parentIds: [...new Set(Array.isArray(value.parentIds) ? value.parentIds.filter(Boolean) : [])],
    childIds: [...new Set(Array.isArray(value.childIds) ? value.childIds.filter(Boolean) : [])],
    cooldowns: value.cooldowns && typeof value.cooldowns === 'object' ? value.cooldowns : {},
    createdAt: value.createdAt || Date.now(),
  };
}

async function getFamily(db, guildId, userId) {
  const record = await db.get(familyKey(guildId, userId), null);
  return normalizeFamily(record);
}

async function saveFamily(db, guildId, userId, record) {
  await db.set(familyKey(guildId, userId), normalizeFamily(record));
}

function removeId(list, userId) {
  return list.filter((id) => id !== userId);
}

function mention(userId) {
  return `<@${userId}>`;
}

function mentionList(ids, emptyText = 'None') {
  if (!ids.length) return emptyText;

  const visible = ids.slice(0, 10).map(mention);
  const remaining = ids.length - visible.length;

  return remaining > 0
    ? `${visible.join(', ')} and ${remaining} more`
    : visible.join(', ');
}

function formatTime(milliseconds) {
  const totalSeconds = Math.ceil(milliseconds / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (seconds === 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${minutes} minute${minutes === 1 ? '' : 's'} and ${seconds} second${seconds === 1 ? '' : 's'}`;
}

function cooldownRemaining(record, action) {
  const lastUsed = Number(record.cooldowns?.[action] || 0);
  const cooldown = COOLDOWNS[action] || 0;
  const remaining = lastUsed + cooldown - Date.now();

  return remaining > 0 ? remaining : 0;
}

function useCooldown(record, action) {
  record.cooldowns[action] = Date.now();
}

function randomEvent() {
  if (Math.random() > EVENT_CHANCE) return null;

  return RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)];
}

function addRandomEvent(text) {
  const event = randomEvent();
  return event ? `${text}\n\nRandom family event: ${event}` : text;
}

async function reply(interaction, description) {
  return InteractionHelper.safeEditReply(interaction, {
    embeds: [
      createEmbed({
        title: 'Family',
        description,
        color: 'primary',
      }),
    ],
  });
}

async function isAncestor(db, guildId, possibleAncestorId, userId, visited = new Set()) {
  if (possibleAncestorId === userId) return false;
  if (visited.has(userId)) return false;

  visited.add(userId);

  const record = await getFamily(db, guildId, userId);

  for (const parentId of record.parentIds) {
    if (parentId === possibleAncestorId) return true;

    if (await isAncestor(db, guildId, possibleAncestorId, parentId, visited)) {
      return true;
    }
  }

  return false;
}

async function areBloodRelated(db, guildId, firstId, secondId) {
  const [first, second] = await Promise.all([
    getFamily(db, guildId, firstId),
    getFamily(db, guildId, secondId),
  ]);

  const sharedParent = first.parentIds.some((parentId) => second.parentIds.includes(parentId));

  return (
    first.parentIds.includes(secondId) ||
    second.parentIds.includes(firstId) ||
    sharedParent ||
    await isAncestor(db, guildId, firstId, secondId) ||
    await isAncestor(db, guildId, secondId, firstId)
  );
}

function targetError(interaction, target, action) {
  if (!target) return 'Please choose a user.';
  if (target.id === interaction.user.id) return `You cannot ${action} yourself. Nice try.`;
  if (target.bot) return `You cannot ${action} a bot.`;
  return null;
}

async function handleMarry(interaction, db) {
  const target = interaction.options.getUser('user');
  const error = targetError(interaction, target, 'marry');

  if (error) return reply(interaction, error);

  const [authorFamily, targetFamily] = await Promise.all([
    getFamily(db, interaction.guildId, interaction.user.id),
    getFamily(db, interaction.guildId, target.id),
  ]);

  const remaining = cooldownRemaining(authorFamily, 'marry');
  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before getting married again.`);
  }

  if (authorFamily.partnerId) {
    return reply(interaction, 'You are already married. Handle that situation before starting another one.');
  }

  if (targetFamily.partnerId) {
    return reply(interaction, 'That user is already married.');
  }

  if (await areBloodRelated(db, interaction.guildId, interaction.user.id, target.id)) {
    return reply(interaction, 'You cannot marry a parent, child, sibling, or other blood relative.');
  }

  authorFamily.partnerId = target.id;
  targetFamily.partnerId = interaction.user.id;
  useCooldown(authorFamily, 'marry');

  await Promise.all([
    saveFamily(db, interaction.guildId, interaction.user.id, authorFamily),
    saveFamily(db, interaction.guildId, target.id, targetFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} married ${mention(target.id)} without asking.\nSomehow, it worked.`),
  );
}

async function handleDivorce(interaction, db) {
  const authorFamily = await getFamily(db, interaction.guildId, interaction.user.id);

  const remaining = cooldownRemaining(authorFamily, 'divorce');
  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before divorcing again.`);
  }

  if (!authorFamily.partnerId) {
    return reply(interaction, 'You are not married.');
  }

  const partnerId = authorFamily.partnerId;
  const partnerFamily = await getFamily(db, interaction.guildId, partnerId);

  authorFamily.partnerId = null;
  partnerFamily.partnerId = null;
  useCooldown(authorFamily, 'divorce');

  await Promise.all([
    saveFamily(db, interaction.guildId, interaction.user.id, authorFamily),
    saveFamily(db, interaction.guildId, partnerId, partnerFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} divorced ${mention(partnerId)}.\nThe family group chat is now awkward.`),
  );
}

async function handleAdopt(interaction, db) {
  const target = interaction.options.getUser('user');
  const error = targetError(interaction, target, 'adopt');

  if (error) return reply(interaction, error);

  const [authorFamily, targetFamily] = await Promise.all([
    getFamily(db, interaction.guildId, interaction.user.id),
    getFamily(db, interaction.guildId, target.id),
  ]);

  const remaining = cooldownRemaining(authorFamily, 'adopt');
  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before adopting another person.`);
  }

  if (authorFamily.partnerId === target.id || targetFamily.partnerId === interaction.user.id) {
    return reply(interaction, 'You cannot adopt your spouse. The family paperwork refuses to continue.');
  }

  if (targetFamily.parentIds.includes(interaction.user.id)) {
    return reply(interaction, 'That user is already your child.');
  }

  if (targetFamily.parentIds.length >= 2) {
    return reply(interaction, 'That user already has two parents.');
  }

  if (await areBloodRelated(db, interaction.guildId, interaction.user.id, target.id)) {
    return reply(interaction, 'You cannot adopt someone who is already part of your blood family.');
  }

  authorFamily.childIds.push(target.id);
  targetFamily.parentIds.push(interaction.user.id);
  useCooldown(authorFamily, 'adopt');

  await Promise.all([
    saveFamily(db, interaction.guildId, interaction.user.id, authorFamily),
    saveFamily(db, interaction.guildId, target.id, targetFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} adopted ${mention(target.id)}.\nWelcome to the family, kiddo.`),
  );
}

async function handleDisown(interaction, db) {
  const target = interaction.options.getUser('user');
  const error = targetError(interaction, target, 'disown');

  if (error) return reply(interaction, error);

  const [authorFamily, targetFamily] = await Promise.all([
    getFamily(db, interaction.guildId, interaction.user.id),
    getFamily(db, interaction.guildId, target.id),
  ]);

  const remaining = cooldownRemaining(authorFamily, 'disown');
  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before disowning someone again.`);
  }

  if (authorFamily.childIds.includes(target.id)) {
    authorFamily.childIds = removeId(authorFamily.childIds, target.id);
    targetFamily.parentIds = removeId(targetFamily.parentIds, interaction.user.id);
  } else if (authorFamily.parentIds.includes(target.id)) {
    authorFamily.parentIds = removeId(authorFamily.parentIds, target.id);
    targetFamily.childIds = removeId(targetFamily.childIds, interaction.user.id);
  } else {
    return reply(interaction, 'That user is not your direct parent or child.');
  }

  useCooldown(authorFamily, 'disown');

  await Promise.all([
    saveFamily(db, interaction.guildId, interaction.user.id, authorFamily),
    saveFamily(db, interaction.guildId, target.id, targetFamily),
  ]);

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} has disowned ${mention(target.id)}.\nYou are no longer invited to Family Dinner.`),
  );
}

async function handleProfile(interaction, db, showTree = false) {
  const target = interaction.options.getUser('user') || interaction.user;

  if (target.bot) {
    return reply(interaction, 'Bots do not have a family profile.');
  }

  const family = await getFamily(db, interaction.guildId, target.id);

  const description = [
    `Family profile for ${mention(target.id)}`,
    '',
    `Partner: ${family.partnerId ? mention(family.partnerId) : 'None'}`,
    `Parents: ${mentionList(family.parentIds)}`,
    `Children: ${mentionList(family.childIds)}`,
  ];

  if (showTree) {
    const siblings = [];

    for (const parentId of family.parentIds) {
      const parent = await getFamily(db, interaction.guildId, parentId);

      for (const childId of parent.childIds) {
        if (childId !== target.id && !siblings.includes(childId)) {
          siblings.push(childId);
        }
      }
    }

    description.push(`Siblings: ${mentionList(siblings)}`);
  }

  return reply(interaction, description.join('\n'));
}

async function handleSocialAction(interaction, db, action) {
  const target = interaction.options.getUser('user');
  const error = targetError(interaction, target, action);

  if (error) return reply(interaction, error);

  const authorFamily = await getFamily(db, interaction.guildId, interaction.user.id);
  const remaining = cooldownRemaining(authorFamily, action);

  if (remaining) {
    return reply(interaction, `You must wait ${formatTime(remaining)} before using this action again.`);
  }

  useCooldown(authorFamily, action);
  await saveFamily(db, interaction.guildId, interaction.user.id, authorFamily);

  const socialAction = SOCIAL_ACTIONS[action];

  return reply(
    interaction,
    addRandomEvent(`${mention(interaction.user.id)} ${socialAction.verb} ${mention(target.id)}.\n${socialAction.text}`),
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('fun')
    .setDescription('Fun commands')
    .setDMPermission(false)
    .addSubcommandGroup((group) =>
      group
        .setName('family')
        .setDescription('Family actions')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('marry')
            .setDescription('Marry someone instantly')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to marry').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('divorce')
            .setDescription('Divorce your current partner'),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('adopt')
            .setDescription('Adopt someone instantly')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to adopt').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('disown')
            .setDescription('Disown a direct parent or child')
            .addUserOption((option) =>
              option.setName('user').setDescription('The family member to disown').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('profile')
            .setDescription('View a family profile')
            .addUserOption((option) =>
              option.setName('user').setDescription('The user to view'),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('tree')
            .setDescription('View a family tree')
            .addUserOption((option) =>
              option.setName('user').setDescription('The user to view'),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('hug')
            .setDescription('Hug someone')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to hug').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('kiss')
            .setDescription('Give someone a kiss')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to kiss').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('protect')
            .setDescription('Protect someone')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to protect').setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName('tease')
            .setDescription('Tease someone')
            .addUserOption((option) =>
              option.setName('user').setDescription('The person to tease').setRequired(true),
            ),
        ),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    if (!interaction.inGuild()) {
      return reply(interaction, 'This command can only be used in a server.');
    }

    const db = interaction.client.db;

    if (!db) {
      return reply(interaction, 'The family system is not available right now.');
    }

    const group = interaction.options.getSubcommandGroup(false);
    const action = interaction.options.getSubcommand();

    if (group !== 'family') {
      return reply(interaction, 'Please choose a family action.');
    }

    try {
      if (action === 'marry') return handleMarry(interaction, db);
      if (action === 'divorce') return handleDivorce(interaction, db);
      if (action === 'adopt') return handleAdopt(interaction, db);
      if (action === 'disown') return handleDisown(interaction, db);
      if (action === 'profile') return handleProfile(interaction, db);
      if (action === 'tree') return handleProfile(interaction, db, true);
      if (SOCIAL_ACTIONS[action]) return handleSocialAction(interaction, db, action);

      return reply(interaction, 'Please choose a valid family action.');
    } catch (error) {
      console.error('Family command error:', error);
      return reply(interaction, 'Something went wrong while updating the family.');
    }
  },
};
*/
