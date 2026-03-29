import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { REST, Routes } from 'discord.js';

import { parseOptionalProvider, resolveDiscordToken } from '../src/bot-instance-utils.js';
import { loadRuntimeEnv } from '../src/env-loader.js';
import { configureRuntimeProxy, renderMissingDiscordTokenHint } from '../src/runtime-bootstrap.js';
import {
  buildSendChannelMessageUsage,
  parseSendChannelMessageArgs,
  resolveSendChannelMessageContent,
} from '../src/send-channel-message.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function main() {
  let options;
  try {
    options = parseSendChannelMessageArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error('');
    console.error(buildSendChannelMessageUsage());
    process.exit(1);
  }

  if (options.help) {
    console.log(buildSendChannelMessageUsage());
    return;
  }

  if (options.provider) {
    if (options.provider === 'shared') {
      delete process.env.BOT_PROVIDER;
    } else {
      process.env.BOT_PROVIDER = options.provider;
    }
  }

  const envState = loadRuntimeEnv({ rootDir, env: process.env });
  const botProvider = parseOptionalProvider(process.env.BOT_PROVIDER);
  const { logs, restProxyAgent } = configureRuntimeProxy({
    env: process.env,
    envFilePath: envState.writableEnvFile,
  });
  for (const line of logs) {
    console.error(line);
  }

  const discordToken = resolveDiscordToken({ botProvider, env: process.env });
  if (!discordToken) {
    console.error(renderMissingDiscordTokenHint({ botProvider, env: process.env }));
    process.exit(1);
  }

  const content = await resolveSendChannelMessageContent(options);
  const rest = new REST({ version: '10' }).setToken(discordToken);
  if (restProxyAgent) {
    rest.setAgent(restProxyAgent);
  }

  const response = await rest.post(Routes.channelMessages(options.channelId), {
    body: { content },
  });

  if (options.json) {
    console.log(JSON.stringify({
      channelId: options.channelId,
      messageId: response.id,
      provider: botProvider || 'shared',
      contentLength: content.length,
    }, null, 2));
    return;
  }

  console.log(`Sent message ${response.id} to channel ${options.channelId} using ${botProvider || 'shared'} token.`);
}

main().catch((err) => {
  console.error(`Failed to send channel message: ${err?.message || err}`);
  process.exit(1);
});
