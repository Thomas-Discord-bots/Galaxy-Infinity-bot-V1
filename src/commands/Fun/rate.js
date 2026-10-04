import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const COMMENTS = [
  'Main character energy detected.',
  'This result has been reviewed by absolutely nobody.',
  'The science is questionable, but the result is final.',
  'A surprisingly respectable score.',
  'The rating machine sounded concerned.',
  'This is better than expected.',
  'This explains a lot.',
  'The universe has spoken.',
  'No further questions will be accepted.',
];

function getRatingComment(score) {
  if (score === 100) return 'Perfect score. This should probably be illegal.';
  if (score >= 90) return 'Elite levels of energy.';
  if (score >= 75) return 'Very impressive.';
  if (score >= 50) return 'Not bad at all.';
  if (score >= 25) return 'There is room for improvement.';
  if (score >= 1) return 'That is unfortunate.';
  return 'Zero. The rating machine has given up.';
}

export default {
  data: new SlashCommandBuilder()
    .setName('rate')
    .setDescription('Give someone a completely random rating')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to rate')
        .setRequired(true),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const user = interaction.options.getUser('user', true);
    const score = Math.floor(Math.random() * 101);
    const comment = Math.random() < 0.7
      ? getRatingComment(score)
      : COMMENTS[Math.floor(Math.random() * COMMENTS.length)];

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Random Rating',
          description: `${user} received a score of **${score}/100**.\n\n${comment}`,
          color: 'primary',
        }),
      ],
    });
  },
};
