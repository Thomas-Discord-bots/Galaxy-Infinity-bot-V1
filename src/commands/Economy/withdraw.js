import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData, getMaxBankCapacity } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BotConfig } from '../../config/bot.js';

export default {
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('Withdraw money from your bank to your wallet')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount to withdraw')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        await InteractionHelper.safeDefer(interaction);
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const amountInput = interaction.options.getInteger("amount");

            const userData = await getEconomyData(client, guildId, userId);
            
            if (!userData) {
                throw createError(
                    "Failed to load economy data",
                    ErrorTypes.DATABASE,
                    "Failed to load your economy data. Please try again later.",
                    { userId, guildId }
                );
            }

            let withdrawAmount = amountInput;

            if (withdrawAmount <= 0) {
                throw createError(
                    "Invalid withdrawal amount",
                    ErrorTypes.VALIDATION,
                    "You must withdraw a positive amount.",
                    { amount: withdrawAmount, userId }
                );
            }

            // Admin can withdraw even if bank < amount (DB may go negative)
            if (withdrawAmount > userData.bank && userId !== BotConfig.adminUserId) {
                withdrawAmount = userData.bank;
            }

            if (withdrawAmount === 0) {
                throw createError(
                    "Empty bank account",
                    ErrorTypes.VALIDATION,
                    "Your bank account is empty.",
                    { userId, bankBalance: userData.bank }
                );
            }

            userData.wallet += withdrawAmount;
            userData.bank -= withdrawAmount;

            await setEconomyData(client, guildId, userId, userData);

            // Format balance display for admin
            const isAdmin = userId === BotConfig.adminUserId;
            const walletDisplay = isAdmin ? '∞ (Infinite)' : `$${userData.wallet.toLocaleString()}`;
            const bankDisplay = isAdmin ? '∞ (Infinite)' : `$${userData.bank.toLocaleString()}`;

            const embed = successEmbed(
                'Withdrawal Successful',
                `You successfully withdrew **$${withdrawAmount.toLocaleString()}** from your bank.`
            )
                .addFields(
                    {
                        name: "💵 New Cash Balance",
                        value: walletDisplay,
                        inline: true,
                    },
                    {
                        name: "🏦 New Bank Balance",
                        value: bankDisplay,
                        inline: true,
                    },
                );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'withdraw' })
};
