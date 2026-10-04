import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const ANSWERS = [
  'Yes.',
  'No.',
  'Nah.',
  'Of course.',
  'Definitely.',
  '100%.',
  'Without a doubt.',
  'Probably.',
  'defo',
  'Ask your mother.',
  'The signs point to yes.',
  'The signs point to no.',
  'Very likely.',
  'Not today.',
  'Absolutely not.',
  'I would not count on it.',
  'That sounds suspiciously possible.',
  'The answer is hiding from me.',
  'You already know the answer.',
  'Try asking in a more dramatic way.',
];

export default {
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the magic 8 ball a question')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('question')
        .setDescription('The question you want to ask')
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(300),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const question = interaction.options.getString('question', true).trim();
    const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)];

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Magic 8 Ball',
          description: `Question:\n> ${question}\n\nAnswer:\n**${answer}**`,
          color: 'primary',
        }),
      ],
    });
  },
};
