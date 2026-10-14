require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const {
  Client, GatewayIntentBits, Partials, ChannelType, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  StringSelectMenuBuilder, SlashCommandBuilder, REST, Routes
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const DATA_DIR = path.join(__dirname, "data");
const STOCK_FILE = path.join(DATA_DIR, "stock.json");
const GIVEAWAYS_FILE = path.join(DATA_DIR, "giveaways.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    (process.env.ADMIN_ROLE_ID && interaction.member?.roles?.cache?.has(process.env.ADMIN_ROLE_ID));
}
function brl(value) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function cleanName(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "ticket";
}
function stock() { return readJson(STOCK_FILE, []); }
function saveStock(items) { writeJson(STOCK_FILE, items); }
function giveaways() { return readJson(GIVEAWAYS_FILE, {}); }
function saveGiveaways(data) { writeJson(GIVEAWAYS_FILE, data); }

const commands = [
  new SlashCommandBuilder().setName("publicar-estoque").setDescription("Publica o catálogo de frutas neste canal.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("adicionar-fruta").setDescription("Adiciona ou atualiza uma fruta no estoque.")
    .addStringOption(o => o.setName("nome").setDescription("Nome da fruta").setRequired(true))
    .addNumberOption(o => o.setName("preco").setDescription("Preço em reais, ex.: 6.5").setRequired(true).setMinValue(0.01))
    .addIntegerOption(o => o.setName("quantidade").setDescription("Quantidade disponível").setRequired(true).setMinValue(0))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("remover-fruta").setDescription("Remove uma fruta do catálogo.")
    .addStringOption(o => o.setName("nome").setDescription("Nome exato da fruta").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("sorteio").setDescription("Cria um sorteio com botão de participação.")
    .addStringOption(o => o.setName("premio").setDescription("Prêmio do sorteio").setRequired(true))
    .addIntegerOption(o => o.setName("minutos").setDescription("Duração em minutos (1 a 10080)").setRequired(true).setMinValue(1).setMaxValue(10080))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("encerrar-sorteio").setDescription("Encerra um sorteio e escolhe um ganhador.")
    .addStringOption(o => o.setName("id-mensagem").setDescription("ID da mensagem do sorteio").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log("Comandos slash registrados no servidor.");
}

client.once("ready", () => {
  console.log(`Bot conectado como ${client.user.tag}`);
});

client.on("guildMemberAdd", async member => {
  const channelId = process.env.WELCOME_CHANNEL_ID;
  if (!channelId) return;
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send(`👋 Seja bem-vindo(a), ${member}! Confira as regras e o estoque da loja de Blox Fruits.`);
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (["publicar-estoque", "adicionar-fruta", "remover-fruta", "sorteio", "encerrar-sorteio"].includes(interaction.commandName) && !isAdmin(interaction)) {
        return interaction.reply({ content: "❌ Apenas a equipe autorizada pode usar esse comando.", ephemeral: true });
      }

      if (interaction.commandName === "adicionar-fruta") {
        const name = interaction.options.getString("nome", true).trim();
        const price = interaction.options.getNumber("preco", true);
        const quantity = interaction.options.getInteger("quantidade", true);
        const items = stock();
        const existing = items.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (existing) { existing.price = price; existing.quantity = quantity; }
        else items.push({ id: cleanName(name), name, price, quantity });
        saveStock(items);
        return interaction.reply({ content: `✅ **${name}** salvo no estoque: ${brl(price)} — quantidade: ${quantity}.`, ephemeral: true });
      }

      if (interaction.commandName === "remover-fruta") {
        const name = interaction.options.getString("nome", true).trim();
        const items = stock();
        const next = items.filter(x => x.name.toLowerCase() !== name.toLowerCase());
        if (next.length === items.length) return interaction.reply({ content: "Não encontrei uma fruta com esse nome.", ephemeral: true });
        saveStock(next);
        return interaction.reply({ content: `🗑️ **${name}** removido do estoque.`, ephemeral: true });
      }

      
      if (interaction.commandName === "publicar-estoque") {
        const items = stock().filter(x => x.quantity > 0);

        if (!items.length) {
          return interaction.reply({
            content: "❌ O estoque está vazio.",
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const embed = new EmbedBuilder()
          .setTitle("🍎 ESTOQUE DE FRUTAS — À VENDA")
          .setDescription(
            items.map(item =>
              `**🍏 ${item.name}** — ${brl(item.price)} | Estoque: ${item.quantity}`
            ).join("\n")
          )
          .setColor(0x2588ff)
          .setFooter({ text: "Selecione uma fruta no menu abaixo para iniciar sua compra." });

        const menu = new StringSelectMenuBuilder()
          .setCustomId("fruit_select")
          .setPlaceholder("🍎 Escolha a fruta que deseja comprar")
          .addOptions(
            items.slice(0, 25).map(item => ({
              label: item.name.slice(0, 100),
              description: `${brl(item.price)} | Disponíveis: ${item.quantity}`.slice(0, 100),
              value: item.id,
              emoji: "🍏"
            }))
          );

        const row = new ActionRowBuilder().addComponents(menu);

        await interaction.channel.send({
          embeds: [embed],
          components: [row]
        });

        return interaction.editReply("✅ Catálogo com menu publicado!");
      }

      if (interaction.commandName === "sorteio") {
        const prize = interaction.options.getString("premio", true);
        const minutes = interaction.options.getInteger("minutos", true);
        const endsAt = Date.now() + minutes * 60_000;
        const embed = new EmbedBuilder().setTitle("🎉 SORTEIO").setDescription(`**Prêmio:** ${prize}\nClique em 🎉 Participar para entrar!\n**Termina:** <t:${Math.floor(endsAt / 1000)}:R>`)
          .setColor(0x8b5cf6);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("giveaway:join").setLabel("🎉 Participar").setStyle(ButtonStyle.Success)
        );
        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });
        const all = giveaways();
        all[msg.id] = { guildId: interaction.guildId, channelId: interaction.channelId, prize, endsAt, entrants: [], ended: false };
        saveGiveaways(all);
        await interaction.reply({ content: `✅ Sorteio criado. ID da mensagem: \`${msg.id}\`. Para encerrar antes, use /encerrar-sorteio id-mensagem:${msg.id}`, ephemeral: true });
        setTimeout(() => finishGiveaway(msg.id).catch(console.error), minutes * 60_000);
        return;
      }

      if (interaction.commandName === "encerrar-sorteio") {
        const messageId = interaction.options.getString("id-mensagem", true);
        await interaction.deferReply({ ephemeral: true });
        const winner = await finishGiveaway(messageId);
        return interaction.editReply(winner ? `🎉 Sorteio encerrado! Ganhador: <@${winner}>` : "Sorteio encerrado, mas não havia participantes (ou o ID não existe).");
      }
    }

    if (interaction.isButton() || (interaction.isStringSelectMenu() && interaction.customId === "fruit_select")) {
      if (
  (interaction.isButton() && interaction.customId.startsWith("buy:")) ||
  (interaction.isStringSelectMenu() && interaction.customId === "fruit_select")
) {
  const productId = interaction.isStringSelectMenu()
    ? interaction.values[0]
    : interaction.customId.slice(4);
        const item = stock().find(x => x.id === productId && x.quantity > 0);
        if (!item) return interaction.reply({ content: "❌ Essa fruta está indisponível no momento.", ephemeral: true });
        const existing = interaction.guild.channels.cache.find(c => c.name === `pedido-${cleanName(interaction.user.username)}-${productId}`.slice(0, 95));
        if (existing) return interaction.reply({ content: `Você já tem um ticket aberto: ${existing}`, ephemeral: true });

        const supportRoleId = process.env.ADMIN_ROLE_ID;
const supportRole = supportRoleId ? interaction.guild.roles.cache.get(supportRoleId) : null;
        const overwrites = [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
        ];
      
        if (supportRole) overwrites.push({ id: supportRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        const ticket = await interaction.guild.channels.create({
          name: `pedido-${cleanName(interaction.user.username)}-${productId}`.slice(0, 95),
          type: ChannelType.GuildText,
          permissionOverwrites: overwrites,
          topic: `Pedido ${item.name} | cliente ${interaction.user.id} | produto ${item.id}`
        });
        const pix = process.env.PIX_KEY || "CONFIGURE_SUA_CHAVE_PIX_NO_ARQUIVO_ENV";
        const payEmbed = new EmbedBuilder().setTitle("🧾 Pedido de compra")
          .setDescription(`**Cliente:** ${interaction.user}\n**Produto:** ${item.name}\n**Valor:** ${brl(item.price)}\n**Quantidade disponível agora:** ${item.quantity}\n\n**Pix:** \`${pix}\`\n\nApós pagar, envie o comprovante aqui. A equipe verificará o recebimento diretamente na conta antes de aprovar. **Não envie senhas ou dados de login.**`)
          .setColor(0x2588ff);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`paid:${item.id}:${interaction.user.id}`).setLabel("✅ Confirmar pagamento").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("ticket:close").setLabel("🔒 Fechar ticket").setStyle(ButtonStyle.Danger)
        );
        await ticket.send({ content: `${interaction.user} ${supportRole ? `<@&${supportRole}>` : ""}`, embeds: [payEmbed], components: [row] });
        return interaction.reply({ content: `✅ Seu ticket foi criado: ${ticket}`, ephemeral: true });
      }

      if (interaction.customId.startsWith("paid:")) {
        if (!isAdmin(interaction)) return interaction.reply({ content: "❌ Apenas a equipe pode confirmar o pagamento.", ephemeral: true });
        const [, productId, buyerId] = interaction.customId.split(":");
        if ((interaction.channel.topic || "").includes("PAGO_CONFIRMADO")) {
          return interaction.reply({ content: "Este pagamento já foi confirmado anteriormente.", ephemeral: true });
        }
        const items = stock();
        const item = items.find(x => x.id === productId);
        if (!item || item.quantity < 1) return interaction.reply({ content: "❌ Não há unidades disponíveis. Confira o estoque antes de aprovar.", ephemeral: true });
        await interaction.deferReply();
        item.quantity -= 1;
        saveStock(items);
        await interaction.channel.setTopic(`${interaction.channel.topic || ""} | PAGO_CONFIRMADO`).catch(() => {});
        const salesChannel = await interaction.guild.channels.fetch(process.env.SALES_CHANNEL_ID).catch(() => null);
        if (salesChannel?.isTextBased()) {
          await salesChannel.send(`✅ **VENDA CONCLUÍDA**\n🍎 **Produto:** ${item.name}\n💰 **Valor:** ${brl(item.price)}\n🛒 **Comprador:** <@${buyerId}>\n🤝 **Atendido por:** ${interaction.user}`);
        }
        await interaction.editReply(`✅ Pagamento confirmado pela equipe. Estoque atualizado: **${item.name}** agora tem ${item.quantity} unidade(s).`);
        await interaction.message.edit({ components: interaction.message.components.map(row => {
          const newRow = ActionRowBuilder.from(row);
          newRow.components = newRow.components.map(c => {
            const b = ButtonBuilder.from(c);
            if (b.data.custom_id?.startsWith("paid:")) b.setDisabled(true).setLabel("Pagamento confirmado");
            return b;
          });
          return newRow;
        }) }).catch(() => {});
        return;
      }

      if (interaction.customId === "ticket:close") {
        const topic = interaction.channel.topic || "";
        const buyerId = topic.match(/cliente (\d+)/)?.[1];
        if (!isAdmin(interaction) && interaction.user.id !== buyerId) {
          return interaction.reply({ content: "Só o comprador ou a equipe pode fechar este ticket.", ephemeral: true });
        }
        await interaction.reply("🔒 Este ticket será apagado em 5 segundos.");
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
        return;
      }

      if (interaction.customId === "giveaway:join") {
        const all = giveaways();
        const entry = Object.entries(all).find(([id, g]) => !g.ended && g.channelId === interaction.channelId && Date.now() < g.endsAt);
        if (!entry) return interaction.reply({ content: "Esse sorteio já terminou ou não está disponível.", ephemeral: true });
        const g = entry[1];
        if (g.entrants.includes(interaction.user.id)) return interaction.reply({ content: "Você já está participando! 🍀", ephemeral: true });
        g.entrants.push(interaction.user.id);
        saveGiveaways(all);
        return interaction.reply({ content: "🎉 Você está participando do sorteio!", ephemeral: true });
      }
    }
  } catch (err) {
    console.error(err);
    const message = "Ocorreu um erro. Confira as permissões do bot e o terminal.";
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    } else if (interaction.isRepliable() && interaction.deferred) {
      await interaction.editReply(message).catch(() => {});
    }
  }
});

async function finishGiveaway(messageId) {
  const all = giveaways();
  const g = all[messageId];
  if (!g || g.ended) return null;
  g.ended = true;
  saveGiveaways(all);
  let channel;
  try { channel = await client.channels.fetch(g.channelId); } catch { return null; }
  let message;
  try { message = await channel.messages.fetch(messageId); } catch { return null; }
  const entrants = g.entrants || [];
  const winner = entrants.length ? entrants[Math.floor(Math.random() * entrants.length)] : null;
  await message.edit({ embeds: [new EmbedBuilder().setTitle("🎉 SORTEIO ENCERRADO")
    .setDescription(`**Prêmio:** ${g.prize}\n${winner ? `**Ganhador:** <@${winner}>` : "Ninguém participou deste sorteio."}`)
    .setColor(0x8b5cf6)], components: [] });
  if (winner) await channel.send(`🎉 Parabéns <@${winner}>! Você ganhou **${g.prize}**!`);
  return winner;
}

(async () => {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
    console.error("Configure DISCORD_TOKEN, CLIENT_ID e GUILD_ID no arquivo .env.");
    process.exit(1);
  }
  await registerCommands();
  await client.login(process.env.DISCORD_TOKEN);
})();
