function hello(eventData){
    var bot = eventData.bot;
    var message = eventData.message;

    bot.reply(message, "Hello back!");
}

function minimalHello(word){
    console.log("USER GREET WITH \"" + word + "\"");
}

exports.preEvent = function(eventData){
    if(/hello/.test(eventData.message.text)){
        // Continue
        return true;
    }
    // Skipped
    //   return false;
    // Stopped
};

exports.getResponseInfo = function(eventData){
    return {
        "greeting_word": "hello, hi"
    };
};

exports.commands = [
    {
        "pattern": "greet \w+",
        "operation": minimalHello
    }
];

exports.config = {
    sequence: {
        hello: hello
    }
};
