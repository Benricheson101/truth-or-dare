import {
  ApplicationCommandInteractionDataOptionString,
  ApplicationCommandOptionType,
  RESTGetAPIGuildResult,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPostAPIChannelMessageJSONBody,
  RESTPostAPIChannelMessageResult,
} from 'discord-api-types';
import Context from '../classes/Context';
import superagent from 'superagent';
import Command from '../classes/Command';

const ans: Command = {
  name: 'ans',
  description: 'Answers a paranoia question sent to you',
  category: 'question',
  options: [
    {
      type: ApplicationCommandOptionType.String,
      name: 'answer',
      description: 'The answer to the paranoia question',
      required: true,
    },
  ],
  perms: [],
  run: async (ctx: Context): Promise<void> => {
    if (ctx.guildId) return ctx.reply('Paranoia questions can only be answered in DMs');

    const paranoiaData = await ctx.client.database.getParanoiaData(ctx.user.id);
    if (paranoiaData.length === 0) {
      ctx.reply('There are no active paranoia questions');
      return;
    }

    // send answer to the channel the question was sent from
    const messageResponse = await superagent
      .post(`https://discord.com/api/channels/${paranoiaData[0].channelId}/messages`)
      .send({
        embeds: [
          {
            author: {
              name: ctx.user.username,
              icon_url: `https://cdn.discordapp.com/avatars/${ctx.user.id}/${ctx.user.avatar}.png`,
            },
            title: 'Paranoia Answer',
            fields: [
              {
                name: 'Question:',
                value: questionOrHidden(paranoiaData[0].questionText),
              },
              {
                name: `${ctx.user.username}'s Answer:`,
                value: truncateString(
                  (ctx.getOption('answer') as ApplicationCommandInteractionDataOptionString)?.value
                ),
              },
            ],
          },
        ],
      } as RESTPostAPIChannelMessageJSONBody)
      .set('Authorization', `Bot ${ctx.client.token}`)
      .catch(_ => null);
    if (!messageResponse) {
      console.log('Message send failed, no permissions');
      ctx.reply('Failed to send message, try again later');
      return;
    }

    // edit question in DMs in order to make it clear which have been answered
    const editMessageResponse = await superagent
      .patch(
        `https://discord.com/api/channels/${ctx.channelId}/messages/${paranoiaData[0].dmMessageId}`
      )
      .send({
        embeds: [
          {
            title: 'Question Answered',
          },
        ],
      } as RESTPatchAPIChannelMessageJSONBody)
      .set('Authorization', `Bot ${ctx.client.token}`)
      .catch(_ => null);
    if (!editMessageResponse) console.log('Message edit failed, response code: ');

    // remove question from database now that it's been answered
    await ctx.client.database.removeParanoiaQuestion(paranoiaData[0].id);

    ctx.reply(`${ctx.client.EMOTES.checkmark} Answer sent!`);

    // fetch the next queued question, if there is one
    const nextQuestion = await ctx.client.database.getNextParanoia(ctx.user.id);
    if (nextQuestion) {
      // fetch guild to get the server name
      const guildResponse = await superagent
        .get(`https://discord.com/api/guilds/${nextQuestion.guildId}`)
        .set('Authorization', `Bot ${ctx.client.token}`)
        .catch(_ => null);
      if (!guildResponse) return console.log('guild fetch failed');
      const guild = <RESTGetAPIGuildResult>JSON.parse(guildResponse.text);

      // send DM with question
      const dmMessageResponse = await superagent
        .post(`https://discord.com/api/channels/${ctx.channelId}/messages`)
        .send({
          embeds: [
            {
              title: `Paranoia Question from **${guild.name}**`,
              description: 'Use `/ans` to answer this question',
              fields: [
                {
                  name: ' ',
                  value: nextQuestion.questionText,
                },
              ],
              footer: {
                text: `Type: PARANOIA | Rating: ${nextQuestion.questionRating} | ID: ${nextQuestion.questionId}`,
              },
            },
          ],
        } as RESTPostAPIChannelMessageResult)
        .set('Authorization', `Bot ${ctx.client.token}`)
        .catch(_ => null);
      if (dmMessageResponse.status !== 200) return console.log('message send failed, code ' + dmMessageResponse.status);
      const messageSent = <RESTPostAPIChannelMessageResult>JSON.parse(dmMessageResponse.text);

      // set the DM message ID now that the message has been sent
      await ctx.client.database.setParanoiaMessageId(
        nextQuestion.userId,
        nextQuestion.guildId,
        messageSent.id
      );
    }
  },
};

export default ans;

function truncateString(str: string) {
  return str.length > 712 ? str.substring(0, 709) + '...' : str;
}

function questionOrHidden(question: string) {
  return Math.random() < 0.5 ? question : 'Question is kept secret';
}
