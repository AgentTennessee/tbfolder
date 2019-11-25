//imports http package that lets you interact with and get information from outside webpages
const http = require("http");
//imports express package that works with node.js to add a lot more functionality to websites that have constantly updating information, however we use it to keep the bot activated and keep it from autosaving so much
const SQLite = require("better-sqlite3");

//Load config file
const config = require("./config.json");
const sql = new SQLite("./qotd.sqlite");
const CronJob = require("cron").CronJob;

//imports discord package so we can interact with discord API
const Discord = require("discord.js");
//actually makes the client we use for the bot
const client = new Discord.Client();

console.log("Cron job made successfully");
const job = new CronJob("00 00 00 * * *", function() {
  //randomQuestion();
  console.log("Question sent today! All is good in the world");
});

//This event actually calls the bot when it's ready to start working so if you wanted to have the bot do anything as soon as it turns on, like sending a message, updating it's status, or starting any timers you'd put them here
client.on("ready", () => {
  //Sets the bots "Now Playing" status
  client.user.setActivity("Ask me something");
  const table = sql
    .prepare(
      "SELECT count(*) FROM sqlite_master WHERE type='table' AND name = 'questions';"
    )
    .get();
  if (!table["count(*)"]) {
    // If the table isn't there, create it and setup the database correctly.
    sql
      .prepare(
        "CREATE TABLE questions (id TEXT PRIMARY KEY, user TEXT, channel TEXT, question TEXT, date TEXT, approved INTEGER);"
      )
      .run();
    // Ensure that the "id" row is always unique and indexed.
    sql
      .prepare("CREATE UNIQUE INDEX idx_questions_id ON questions (id);")
      .run();
    sql.pragma("synchronous = 1");
    sql.pragma("journal_mode = wal");
  }
  client.addQuestion = sql.prepare(
    "INSERT OR REPLACE INTO questions (id,user,channel,question,date,approved) VALUES(@id, @user, @channel, @question, @date, @approved)"
  );

  //logs in glitch's console that it's ready
  console.log("I am ready!");
  console.log(`Prefix: ${config.prefix}`);
  job.start();
  console.log("Job started successfully");
});

//This event is called whenever anybody messages anywhere the bot has access to and it's usually the event most bots use to function
client.on("message", message => {
  //Stops the bot from interacting with itself or other bots
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.content.indexOf(config.prefix) !== 0) return;
  let newquestion = "";

  // Here we separate our "command" name, and our "arguments" for the command.
  // e.g. if we have the message "+say Is this the real life?" , we'll get the following:
  // command = say
  // args = ["Is", "this", "the", "real", "life?"]

  const args = message.content
    .slice(config.prefix.length)
    .trim()
    .split(/ +/g);
  const command = args.shift().toLowerCase();
  
  console.log(`NEW CMD: ${message.content}`);

  // Ping pong
  if (command === "ping") {
    //Make sure bot is online and can receive commands
    message.channel.send("pong");
  }
  
  // Suggest a question
  // User-side syntax is like this: $PREFIX suggest #channel $QUESTION
  if (command === "suggest") {
    //Bot does nothing if there's nothing after the suggest
    if (args.length >= 1) {
      //If you don't mention a channel first or if the bot doesn't have access to that channel it will tell you
      if (getChannelFromMention(args[0])) {
        //If you don't have anything after the channel mention it will stop you
        if (args.length >= 2) {
          //Make a copy of the array to get the actual suggestion without breaking references to the original array below
          var approveCheck = 0;
          if (message.member.hasPermission("MANAGE_MESSAGES")) {
            approveCheck = 1;
          }
          //check if user has already made more than 5 suggestions for QOTDs
          const amountSubmitted = sql
            .prepare("SELECT * FROM questions WHERE user = ?")
            .all(message.member.id);
          if (amountSubmitted.length < 5) {
            const suggestArray = [...args];
            suggestArray.shift();
            const suggestion = suggestArray.join(" ");
            newquestion = {
              id: message.id,
              user: message.author.id,
              channel: getChannelFromMention(args[0]).id,
              question: suggestion,
              date: message.createdAt.toString(),
              approved: approveCheck
            };
            console.log(
              message.guild.members.get(newquestion.user).displayName +
                " Asked: " +
                newquestion.question +
                " in " +
                client.channels.get(newquestion.channel).name +
                " at " +
                newquestion.date
            );
            client.addQuestion.run(newquestion);
            message.react("👍");
          } else {
            message.channel.send(
              "You have already made 5 suggestions, you can't submit more until yours are used."
            );
          }
        } else {
          message.channel.send("You have to add a suggestion");
        }
      } else {
        message.channel.send("That is not a valid channel");
      }
    }
  }

  // DEBUG FUNC
  // Requires your ID be included in ./config.json
  if (command === "debug_print") {
    if (config.debug.indexOf(message.author.ID) !== -1) {
      message.channel.send(`ID ${message.author.ID} is not in the debug list, sorry!`);
      return;
    }
    
    if (args.length < 1) {
      const rq = sql
        .prepare(
          "SELECT * FROM questions WHERE approved = 1 ORDER BY RANDOM() LIMIT 1;"
        )
        .get();
      if (rq) {
        const questionembed = new Discord.RichEmbed()
          .setTitle("Question of the Day!")
          .setAuthor(
            message.guild.members.get(rq.user).displayName,
            message.guild.members.get(rq.user).user.avatarURL
          )
          .setDescription(message.guild.channels.get(rq.channel))
          .addField(rq.question, "\u200b")
          .setTimestamp(new Date(rq.date));

        message.channel.send(questionembed);
        sql.prepare("DELETE FROM questions WHERE id =?;").run(rq.id);
        console.log("Question #" + rq.id + " successfully removed");
      } else {
        message.channel.send("There was no question to send, suggest more!");
      }
    }
  }
  
  // Get approved questions
  if (command === "waitlist") {
    const notApproved = sql
      .prepare(
        "SELECT * FROM questions WHERE approved = 0 ORDER BY date LIMIT 11"
      )
      .all();
    console.log("Waitlist query generated");
    const questionsEmbed = new Discord.RichEmbed()
      .setTitle("Unapproved QOTDs")
      .setAuthor(client.user.username, client.user.avatarURL)
      .setDescription(
        "Approve or deny QOTDs by typing q!approve/deny id. If you deny a QOTD it will be deleted from the waitlist. Please don't delete the first one, it is what makes the waitlist work."
      )
      .setColor("RANDOM");
    console.log("Base embed generated");
    for (const data of notApproved) {
      if (data.length > 1) {
        questionsEmbed.addField(
          message.guild.members.get(data.user).displayName +
            " Channel: " +
            message.guild.channels.get(data.channel).name +
            " ID: " +
            data.id,
          data.question
        );
      } else {
        questionsEmbed.addField(
          client.user.username,
          "There are no pending questions!"
        );
        break;
      }
    }
    message.channel.send(questionsEmbed);
  }
  
  // Approve a question
  if (command === "approve") {
    // Need to be an admin
    if (config.admin.indexOf(message.author.ID) !== -1) {
      if (args.length == 1) {
        if (!isNaN(args[0])) {
          const qrow = sql.prepare(
            "UPDATE questions SET approved = ? WHERE id = ? LIMIT 1"
          );
          const update = qrow.run(1, args[0]);
          console.log("Question approved");
        }
      } else {
        message.channel.send("Correct usage is q!approve #");
      }
    }
  }
  
  // deny a question
  if (command === "deny") {
    // Must be an admin
    if (config.admin.indexOf(message.author.ID) !== -1) {
      if (args.length == 1) {
        if (!isNaN(args[0])) {
          sql.prepare("DELETE FROM questions WHERE id =?;").run(args[0]);
          console.log("Question denied");
        } else {
        }
      } else {
        message.channel.send("Correct usage is q!deny #");
      }
    }
  }

  // Pull a random question
  function randomQuestion() {
    const rq = sql
      .prepare(
        "SELECT * FROM questions WHERE approved = 1 ORDER BY RANDOM() LIMIT 1;"
      )
      .get();
    if (rq) {
      const questionembed = new Discord.RichEmbed()
        .setTitle("Question of the Day!")
        .setAuthor(
          message.guild.members.get(rq.user).displayName,
          message.guild.members.get(rq.user).user.avatarURL
        )
        .setDescription(message.guild.channels.get(rq.channel))
        .addField(rq.question, "\u200b")
        .setTimestamp(new Date(rq.date));

      client.channels.get("608080775413235755").send(questionembed);
      sql.prepare("DELETE FROM questions WHERE id =?;").run(rq.id);
      console.log("Question #" + rq.id + " successfully removed");
    } else {
      client.channels
        .get("608080775413235755")
        .send("There was no question to send today! Suggest more!");
    }
  }

  function getChannelFromMention(mention) {
    //If no channel was input, stop.
    if (!mention) return;
    //Cut of the discord syntax that bots default to when they see mentions in messages and make sure it's # for channel mentions
    if (mention.startsWith("<#") && mention.endsWith(">")) {
      //cut off the end and beginning to get the channel ID.
      mention = mention.slice(2, -1);
      //Grab the actual channel and return. Returns negative if channel can't be reached
      return client.channels.get(mention);
    }
  }
});

//This lets discord know that you're authorized to use the bot you made on discord's page by inputting the token you got from them.
client.login(process.env.TOKEN);
