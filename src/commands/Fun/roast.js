import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const ROASTS = [
  'You have something on your face. No, the other side. The other other side.',
  'You are proof that autocorrect can only do so much.',
  'Your internet connection has more personality than you do.',
  'You bring everyone so much joy when you leave the voice channel.',
  'You are not useless. You can always serve as a bad example.',
  'Your secrets are safe with me. I was not listening anyway.',
  'You are like a cloud. When you disappear, it becomes a beautiful day.',
  'I would explain it to you, but I left my crayons at home.',
  'You have the confidence of someone who did not read the instructions.',
  'Your brain has too many tabs open and none of them are loading.',
  'You are the human version of a typo.',
  'You are not the sharpest spoon in the drawer.',
  'You are the reason the mute button was invented.',
  'You have the timing of a Windows update.',
  'You are a limited edition. Thankfully.',
];

export default {
  data: new SlashCommandBuilder()
    .setName('roast')
    .setDescription('Give someone a harmless roast')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to roast')
        .setRequired(true),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const user = interaction.options.getUser('user', true);
    const roast = ROASTS[Math.floor(Math.random() * ROASTS.length)];

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Roast',
          description: `${user}, ${roast}`,
          color: 'primary',
        }),
      ],
    });
  },
};
