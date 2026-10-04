import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

function getComment(score) {
  if (score === 100) return 'The PP meter has reached its maximum setting.';
  if (score >= 80) return 'Impressive. The scientists are confused.';
  if (score >= 60) return 'A very respectable result.';
  if (score >= 40) return 'Perfectly average. Nothing suspicious here.';
  if (score >= 20) return 'The meter is trying its best.';
  return 'The PP meter has requested a software update.';
}

export default {
  data: new SlashCommandBuilder()
    .setName('pp')
    .setDescription('Give someone a completely random PP score')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to measure')
        .setRequired(true),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const user = interaction.options.getUser('user', true);
    const score = Math.floor(Math.random() * 101);

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'PP Meter',
          description: `${user} received a PP score of **${score}/100**.\n\n${getComment(score)}`,
          color: 'primary',
        }),
      ],
    });
  },
};
