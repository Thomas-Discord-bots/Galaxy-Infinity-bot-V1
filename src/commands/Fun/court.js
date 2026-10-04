import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const VERDICTS = [
  {
    result: 'Not guilty.',
    extra: 'The evidence was not convincing enough.',
  },
  {
    result: 'Guilty.',
    extra: 'The sentence is one hour of being mildly embarrassed.',
  },
  {
    result: 'Case dismissed.',
    extra: 'The judge got distracted by a sandwich.',
  },
  {
    result: 'Guilty, but forgiven.',
    extra: 'Do not let it happen again. Probably.',
  },
  {
    result: 'Not guilty by reason of questionable decision-making.',
    extra: 'The court will pretend this never happened.',
  },
  {
    result: 'The jury cannot decide.',
    extra: 'Everyone started arguing about snacks instead.',
  },
  {
    result: 'Guilty.',
    extra: 'The punishment is writing an apology to the family group chat.',
  },
];

export default {
  data: new SlashCommandBuilder()
    .setName('court')
    .setDescription('Put someone through a completely fake court case')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The person on trial')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('accusation')
        .setDescription('A silly accusation')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(200),
    ),

  category: 'Fun',

  async execute(interaction) {
    await InteractionHelper.safeDefer(interaction);

    const user = interaction.options.getUser('user', true);
    const accusation = interaction.options.getString('accusation', true);
    const verdict = VERDICTS[Math.floor(Math.random() * VERDICTS.length)];

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'The Court Has Reached a Verdict',
          description: [
            `Defendant: ${user}`,
            `Accusation: ${accusation}`,
            '',
            `Verdict: **${verdict.result}**`,
            verdict.extra,
            '',
            'This court case is completely fictional.',
          ].join('\n'),
          color: 'primary',
        }),
      ],
    });
  },
};
