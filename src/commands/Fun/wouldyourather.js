import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const QUESTIONS = [
  ['Always be 10 minutes late', 'Always be 20 minutes early'],
  ['Have unlimited pizza', 'Have unlimited burgers'],
  ['Speak every language', 'Talk to animals'],
  ['Never use social media again', 'Never watch movies or series again'],
  ['Live without music', 'Live without games'],
  ['Have a pet dragon', 'Have a pet dinosaur'],
  ['Be famous everywhere', 'Be anonymous forever'],
  ['Only eat sweet food', 'Only eat salty food'],
  ['Be able to fly', 'Be able to turn invisible'],
  ['Have unlimited money', 'Have unlimited free time'],
  ['Always have bad internet', 'Always have a low battery'],
  ['Never need sleep', 'Never need to eat'],
  ['Live in the past', 'Live in the future'],
  ['Win every game you play', 'Never lose an argument'],
  ['Only communicate by singing', 'Only communicate by whispering'],
  ['Have a personal chef', 'Have a personal driver'],
  ['Be the funniest person in every room', 'Be the smartest person in every room'],
  ['Know how you will die', 'Know when you will die'],
  ['Have a button that pauses time', 'Have a button that rewinds time'],
  ['Always have perfect hair', 'Always have perfect clothes'],
];

export default {
  data: new SlashCommandBuilder()
    .setName('wouldyourather')
    .setDescription('Get a random would you rather question')
    .setDMPermission(false),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const [firstOption, secondOption] =
      QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Would You Rather',
          description: `Would you rather:\n\nA. ${firstOption}\n\nB. ${secondOption}`,
          color: 'primary',
        }),
      ],
    });
  },
};
