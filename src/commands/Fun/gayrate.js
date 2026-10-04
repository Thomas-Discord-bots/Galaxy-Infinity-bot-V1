import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

function getComment(score) {
  if (score === 100) return 'Maximum fabulous energy detected.';
  if (score >= 80) return 'The vibe scanner is very confident.';
  if (score >= 60) return 'Strong fabulous energy.';
  if (score >= 40) return 'The scanner is still investigating.';
  if (score >= 20) return 'The results are mysterious.';
  return 'The vibe scanner needs more data.';
}

export default {
  data: new SlashCommandBuilder()
    .setName('gayrate')
    .setDescription('Give someone a completely random fabulous score')
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

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Fabulous Meter',
          description: [
            `${user} has **${score}%** fabulous energy today.`,
            '',
            getComment(score),
            '',
            'This is a random fun score, not a real label.',
          ].join('\n'),
          color: 'primary',
        }),
      ],
    });
  },
};
