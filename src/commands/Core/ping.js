import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

// Restrict this command to a specific user ID by default (the owner's Discord ID).
// You can override this by setting ADMIN_USER_ID or OWNER_IDS (comma-separated) in the environment.
const DEFAULT_OWNER_ID = '1507732711241154590';
const envAdmin = process.env.ADMIN_USER_ID;
const envOwners = process.env.OWNER_IDS;
const OWNER_SET = new Set([
    ...((envOwners && envOwners.split(',').map(s => s.trim())) || []),
    ...(envAdmin ? [envAdmin] : []),
    DEFAULT_OWNER_ID,
].filter(Boolean));

function isAllowed(interaction) {
    const id = interaction?.user?.id || interaction?.author?.id || null;
    return id && OWNER_SET.has(id);
}

export default {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Checks the bot's latency and API speed"),

    async prefixExecute(interaction) {
        try {
            if (!isAllowed(interaction)) {
                await interaction.reply({
                    embeds: [createEmbed({ title: 'Unauthorized', description: 'You are not allowed to use this command.', color: 'error' })]
                }).catch(() => {});
                return;
            }

            const startTime = Date.now();
            const pingingMessage = await interaction.reply({ content: 'Pinging...' });

            const latency = Date.now() - startTime;
            const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));

            const embed = createEmbed({ title: 'Pong!', description: null }).addFields(
                { name: 'Bot Latency', value: `${latency}ms`, inline: true },
                { name: 'API Latency', value: `${apiLatency}ms`, inline: true },
            );

            await pingingMessage.edit({ content: null, embeds: [embed] });
        } catch (error) {
            logger.error('Ping prefix command error:', error);
            if (!interaction.replied && !interaction._replyMessage) {
                await interaction.channel.send({
                    embeds: [createEmbed({ title: 'System Error', description: 'Could not determine latency at this time.', color: 'error' })],
                }).catch(() => {});
            }
        }
    },

    async execute(interaction) {
        logger.info('execute called - checking if slash command or prefix command');
        logger.info(`execute - has _commandStartTime: ${!!interaction._commandStartTime}, createdTimestamp: ${interaction.createdTimestamp}`);

        // Check permissions before deferring so unauthorized users get an immediate response
        if (!isAllowed(interaction)) {
            logger.warn('Unauthorized attempt to use ping command', { userId: interaction.user?.id, commandName: 'ping' });
            try {
                await InteractionHelper.safeReply(interaction, {
                    embeds: [createEmbed({ title: 'Unauthorized', description: 'You are not allowed to use this command.', color: 'error' })],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (replyError) {
                logger.error('Failed to send unauthorized reply:', replyError);
            }
            return;
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Ping interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'ping'
            });
            return;
        }

        try {
            await InteractionHelper.safeEditReply(interaction, {
                content: "Pinging...",
            });

            const startTime = interaction._commandStartTime || interaction.createdTimestamp;
            logger.info(`execute - using startTime: ${startTime}, type: ${interaction._commandStartTime ? 'prefix' : 'slash'}`);
            const latency = Math.max(0, Date.now() - startTime);
            const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));
            logger.info(`execute - calculated latency: ${latency}ms, apiLatency: ${apiLatency}ms`);

            const embed = createEmbed({ title: "Pong!", description: null }).addFields(
                { name: "Bot Latency", value: `${latency}ms`, inline: true },
                { name: "API Latency", value: `${apiLatency}ms`, inline: true },
            );

            await InteractionHelper.safeEditReply(interaction, {
                content: null,
                embeds: [embed],
            });
        } catch (error) {
            logger.error('Ping command error:', error);
            try {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [createEmbed({ title: 'System Error', description: 'Could not determine latency at this time.', color: 'error' })],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (replyError) {
                logger.error('Failed to send error reply:', replyError);
            }
        }
    },
};
