import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('reverse')
    .setDescription('Reverse any text')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('text')
        .setDescription('The text to reverse')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(1000),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const text = interaction.options.getString('text', true);
    const reversed = [...text].reverse().join('');

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Reverse',
          description: `Original:\n> ${text}\n\nReversed:\n> ${reversed}`,
          color: 'primary',
        }),
      ],
    });
  },
};
