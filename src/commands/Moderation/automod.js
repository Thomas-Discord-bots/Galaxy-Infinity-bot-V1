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
  ComponentType,
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
      const active = selectedLevel === index + 1 ? 'Current selection: ' : '';
      return `Level ${index + 1}: ${active}${displayPunishment(punishment)}`;
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
      'From violation 6 onward, AutoMod keeps using level 5.',
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
  dashboardMessage,
  render,
  modal,
  inputId,
  save,
  successMessage,
}) {
  await componentInteraction.showModal(modal);

  const submission = await componentInteraction.awaitModalSubmit({
    time: 5 * 60 * 1000,
    filter: (modalInteraction) =>
      modalInteraction.user.id === componentInteraction.user.id &&
      modalInteraction.customId === modal.data.custom_id,
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
    logger.error('AutoMod dashboard modal error:', error);
    await submission.editReply('AutoMod could not save that setting.');
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

    const renderPayload = async () => {
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

    const initialPayload = await renderPayload();
    const dashboardMessage = await interaction.editReply(initialPayload);

    const render = async () => {
      const payload = await renderPayload();
      await dashboardMessage.edit(payload);
    };

    const collector = dashboardMessage.createMessageComponentCollector({
      time: 15 * 60 * 1000,
    });

    collector.on('collect', async (componentInteraction) => {
      if (componentInteraction.user.id !== interaction.user.id) {
        return componentInteraction.reply({
          content: 'Run `/automod dashboard` to open your own dashboard.',
          flags: MessageFlags.Ephemeral,
        });
      }

      try {
        const config = await getAutoModConfig(interaction.guildId);

        if (componentInteraction.customId === 'automod_toggle') {
          await componentInteraction.deferUpdate();
          await setAutoModEnabled(interaction.guildId, !config.enabled);
          return render();
        }

        if (componentInteraction.customId === 'automod_words') {
          const modal = createTextModal({
            customId: 'automod_words_modal',
            title: 'Blacklist words',
            inputId: 'words',
            label: 'Words or phrases, one per line',
            value: config.words.join('\n'),
            placeholder: 'spamword\nanother phrase\nthird word',
          });

          return openTextModal({
            componentInteraction,
            dashboardMessage,
            render,
            modal,
            inputId: 'words',
            save: async (value) => {
              await setAutoModWords(interaction.guildId, parseLines(value));
            },
            successMessage: 'The blacklist was updated.',
          });
        }

        if (componentInteraction.customId === 'automod_punishments') {
          await componentInteraction.deferUpdate();
          view = 'punishments';
          return render();
        }

        if (componentInteraction.customId === 'automod_exceptions') {
          await componentInteraction.deferUpdate();
          view = 'exceptions';
          return render();
        }

        if (componentInteraction.customId === 'automod_back') {
          await componentInteraction.deferUpdate();
          view = 'main';
          return render();
        }

        if (componentInteraction.customId === 'automod_select_level') {
          await componentInteraction.deferUpdate();
          selectedLevel = Number(componentInteraction.values[0]) || 1;
          return render();
        }

        if (componentInteraction.customId === 'automod_select_punishment') {
          await componentInteraction.deferUpdate();

          const punishment = componentInteraction.values[0];

          if (!VALID_PUNISHMENTS.has(punishment)) {
            return;
          }

          await setAutoModPunishment(
            interaction.guildId,
            selectedLevel,
            punishment,
          );

          return render();
        }

        if (componentInteraction.customId === 'automod_channels') {
          const modal = createTextModal({
            customId: 'automod_channels_modal',
            title: 'Ignored channels',
            inputId: 'channels',
            label: 'Channel IDs, one per line',
            value: config.ignoredChannelIds.join('\n'),
            placeholder: '123456789012345678',
          });

          return openTextModal({
            componentInteraction,
            dashboardMessage,
            render,
            modal,
            inputId: 'channels',
            save: async (value) => {
              await updateAutoModConfig(interaction.guildId, {
                ignoredChannelIds: parseIds(value),
              });
            },
            successMessage: 'Ignored channels were updated.',
          });
        }

        if (componentInteraction.customId === 'automod_roles') {
          const modal = createTextModal({
            customId: 'automod_roles_modal',
            title: 'Ignored roles',
            inputId: 'roles',
            label: 'Role IDs, one per line',
            value: config.ignoredRoleIds.join('\n'),
            placeholder: '123456789012345678',
          });

          return openTextModal({
            componentInteraction,
            dashboardMessage,
            render,
            modal,
            inputId: 'roles',
            save: async (value) => {
              await updateAutoModConfig(interaction.guildId, {
                ignoredRoleIds: parseIds(value),
              });
            },
            successMessage: 'Ignored roles were updated.',
          });
        }

        if (componentInteraction.customId === 'automod_users') {
          const modal = createTextModal({
            customId: 'automod_users_modal',
            title: 'Ignored users',
            inputId: 'users',
            label: 'User IDs, one per line',
            value: config.ignoredUserIds.join('\n'),
            placeholder: '123456789012345678',
          });

          return openTextModal({
            componentInteraction,
            dashboardMessage,
            render,
            modal,
            inputId: 'users',
            save: async (value) => {
              await updateAutoModConfig(interaction.guildId, {
                ignoredUserIds: parseIds(value),
              });
            },
            successMessage: 'Ignored users were updated.',
          });
        }

        if (componentInteraction.customId === 'automod_reset') {
          const modal = createTextModal({
            customId: 'automod_reset_modal',
            title: 'Reset AutoMod violations',
            inputId: 'user_id',
            label: 'Discord user ID',
            placeholder: '123456789012345678',
          });

          return openTextModal({
            componentInteraction,
            dashboardMessage,
            render,
            modal,
            inputId: 'user_id',
            save: async (value) => {
              const userId = value.trim();

              if (!/^\d{15,25}$/.test(userId)) {
                throw new Error('Invalid user ID');
              }

              await resetAutoModViolations(interaction.guildId, userId);
            },
            successMessage: 'That user’s AutoMod violation count was reset.',
          });
        }
      } catch (error) {
        logger.error('AutoMod dashboard interaction error:', error);

        if (!componentInteraction.replied && !componentInteraction.deferred) {
          await componentInteraction.reply({
            content: 'Something went wrong while updating AutoMod.',
            flags: MessageFlags.Ephemeral,
          });
        }
      }
    });

    collector.on('end', async () => {
      try {
        await dashboardMessage.edit({
          components: [],
        });
      } catch {
        // The temporary dashboard message may already be gone.
      }
    });
  },
};
