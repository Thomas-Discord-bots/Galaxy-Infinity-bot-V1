import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const COMPLIMENTS = [
  'You make this server better just by being here.',
  'You have excellent taste. Probably.',
  'You are far more capable than you give yourself credit for.',
  'Your energy is genuinely appreciated.',
  'You would survive a zombie apocalypse for at least three days.',
  'You are the kind of person people are happy to see online.',
  'Your sense of humour is dangerously effective.',
  'You have main character energy in the best way.',
  'You are doing better than you think.',
  'You are officially approved by the compliment machine.',
  'You could probably win an argument against a goose.',
  'The world could use more people like you.',
  'You are a certified legend.',
  'You are surprisingly good at existing.',
  'Your future self is probably proud of you.',
];

export default {
  data: new SlashCommandBuilder()
    .setName('compliment')
    .setDescription('Give someone a compliment')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to compliment')
        .setRequired(true),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const user = interaction.options.getUser('user', true);
    const compliment = COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)];

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Compliment',
          description: `${user}, ${compliment}`,
          color: 'primary',
        }),
      ],
    });
  },
};
