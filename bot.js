/*
* @Author: spywhere
* @Date:   2016-01-14 21:36:44
* @Last Modified by:   Sirisak Lueangsaksri
* @Last Modified time: 2016-01-19 17:27:24
*/

var fs = require("fs");
var yaml = require("js-yaml");

var configData = {};
var eventInterceptors = {
    "pre_event": [],
    "on_event": [],
    "post_event": []
};

Object.defineProperty(Object.prototype, "extends", {
    enumerable: false,
    value: function(obj, rootOnly){
        if(typeof(obj) != "object"){
            return this;
        }
        for(var key in obj){
            if(key in this && typeof(obj[key]) == "object" && !rootOnly){
                this[key].extends(obj[key]);
            }else if(key in this && typeof(obj[key]) == "array" && !rootOnly){
                this[key].concat(obj[key]);
            }else{
                this[key] = obj[key];
            }
        }
        return this;
    }
});

function buildSentence(sentences, dictionary){
    var sentence = sentences[Math.floor(Math.random() * sentences.length)];
    var generatedDictionary = {};
    for(var word in dictionary){
        var words = dictionary[word];
        if(typeof(words) == "object"){
            generatedDictionary[word] = words[
                Math.floor(Math.random() * words.length)
            ];
        }else{
            generatedDictionary[word] = words;
        }
    }
    function dictionaryWord(macro, word, tmp, tag){
        if(word in generatedDictionary){
            var output = generatedDictionary[word];
            if(tag && tag.toLowerCase() == "raw"){
                return output;
            }else if(tag && tag.toLowerCase() == "upper"){
                return output.toUpperCase();
            }
            return output.toLowerCase();
        }
        return "";
    }
    return sentence.replace(/<(\w+)(:(\w+))?>/gi, dictionaryWord);
}

var Botkit = require("botkit");
var exec = require("child_process").exec;
var path = require("path");

function reloadSequence(){
    try{
        configData = {};
        console.log("Loading config.yaml...");
        configData = yaml.safeLoad(
            fs.readFileSync("config.yaml", "utf8")
        , {
            "json": true
        });
        // Load extensions
        if(
            "config" in configData &&
            "extensions" in configData["config"]
        ){
            configData["config"]["extensions"].forEach(
                function(extensionPath){
                    console.log("Loading extension " + extensionPath + "...");
                    var extension = require(extensionPath);

                    if("preEvent" in extension){
                        eventInterceptors["pre_event"].push(extension.preEvent);
                    }
                    if("onEvent" in extension){
                        eventInterceptors["on_event"].push(extension.onEvent);
                    }
                    if("postEvent" in extension){
                        eventInterceptors["post_event"].push(extension.postEvent);
                    }
                    if("config" in extension){
                        configData = configData.extends(
                            extension.config
                        );
                    }
                }
            );
        }
        // Load additional configs
        if(
            "config" in configData &&
            "additional_configs" in configData["config"]
        ){
            configData["config"]["additional_configs"].forEach(
                function(configFile){
                    console.log("Loading " + configFile + "...");
                    configData = configData.extends(
                        yaml.safeLoad(
                            fs.readFileSync(configFile, {
                                "json": true
                            })
                        )
                    );
                }
            );
        }
    }catch(err){
        console.log("Error while loading: " + err);
    }
}

reloadSequence();

if(!("config" in configData) || !("bot_token" in configData["config"])){
    console.log("Configuration file is incomplete");
    return;
}

var controller = Botkit.slackbot();
var bot = controller.spawn({
    token: configData["config"]["bot_token"]
})
var buildQueue = [];

bot.startRTM(function(err,bot,payload) {
    if (err) {
        throw new Error("Could not connect to Slack");
    }
});

function shutdownSequence(){
    process.exit();
}

function getResponseInfo(){
    var info = {};
    // TODO: Add public info
    return info;
}

function responseForError(errorCode){
    if(
        !("error_code" in configData) ||
        !(errorCode in configData["error_code"]) ||
        !("answers" in configData["error_code"][errorCode])
    ){
        console.log("No response for error code: " + errorCode);
        return null;
    }
    var errorResponse = configData["error_code"][errorCode];
    return buildSentence(
        errorResponse["answers"],
        getResponseInfo().extends(
            ("dictionary" in errorResponse) ? errorResponse["dictionary"] : {}
        )
    );
}

function triggerSequence(eventData){
    var message = eventData.message;
    var sequenceId = eventData.sequenceId;

    console.log(message);
    bot.reply(message, "Trigger and Response for " + sequenceId);
}

function interceptMessage(bot, message){
    var knowledges = {};
    if("knowledge" in configData){
        knowledges = configData["knowledge"];
    }
    for(var knowledgeType in knowledges){
        var knowledge = knowledges[knowledgeType];
        var pattern = {};
        if("pattern" in knowledge){
            pattern = knowledge["pattern"];
        }
        // Questions not in the pattern
        if(!("questions" in pattern)){
            continue;
        }
        var questions = pattern["questions"];
        var match = null;
        var captureNames = [];
        for(var index=0;index<questions.length;index++){
            captureNames = [];
            var question = questions[index];
            match = message.text.match(new RegExp(question, "i"));
            if(match){
                if(
                    "captures" in pattern &&
                    index < pattern["captures"].length
                ){
                    captureNames = pattern["captures"][index];
                }
                break;
            }
        }
        // No question matched
        if(!match){
            continue;
        }
        var captures = {};
        for(var index=0;index<captureNames.length;index++){
            if(captureNames[index]){
                captures[captureNames[index]] = match[index];
            }
        }

        var cont = true;
        eventInterceptors["pre_event"].forEach(function(interceptor){
            var result = interceptor({
                bot: bot,
                message: message,
                knowledgeType: knowledgeType,
                captures: captures,
                // Helper data
                config: configData,
                // Helper functions
                buildSentence: buildSentence,
                responseForError: responseForError,
                triggerSequence: triggerSequence
            });
            if(typeof(result) != "boolean" || !result){
                cont = result;
                return;
            }
        });
        if(typeof(cont) != "boolean" || !cont){
            if(typeof(cont) == "boolean"){
                console.log("Skipped by extension.preEvent");
                continue;
            }else{
                console.log("Stopped by extension.preEvent");
                return;
            }
        }

        var sequenceId = null;
        if("sequence_map" in knowledge){
            for(var captureName in knowledge["sequence_map"]){
                if(captureName in captures){
                    var mappings = knowledge["sequence_map"][captureName];
                    mappings.forEach(function(mapping){
                        if(
                            "value" in mapping && "map" in mapping &&
                            mapping["value"] == captures[captureName]
                        ){
                            sequenceId = mapping["map"];
                            return;
                        }
                    });
                    if(sequenceId){
                        break;
                    }
                }
            }
        }
        if(!sequenceId && "associate_sequence" in captures){
            sequenceId = captures["associate_sequence"];
        }
        if(!sequenceId && "associate_sequence" in knowledge){
            sequenceId = knowledge["associate_sequence"];
        }

        // Pattern that does not involve sequence (such as FAQs)
        if(!sequenceId){
            if("response" in knowledge && "answers" in knowledge["response"]){
                bot.reply(
                    knowledge["response"]["answers"],
                    getResponseInfo().extends(
                        (
                            "dictionary" in knowledge
                        ) ? knowledge["dictionary"] : {}
                    )
                );
            }else{
                console.log("No response for: " + message.text);
            }
            return;
        }
        if(
            !("sequence" in configData) ||
            !(sequenceId in configData["sequence"])
        ){
            var response = responseForError("seq_not_found");
            if(response){
                bot.reply(message, response);
            }
            return;
        }
        var supported = false;
        if("supported_sequences" in knowledge){
            var supportedSequences = knowledge["supported_sequences"];
            supportedSequences.forEach(function(seq){
                if(seq == sequenceId){
                    supported = true;
                    return;
                }
            });
        }else{
            supported = true;
        }
        // Sequence not supported
        if(!supported){
            console.log("Sequence not supported: " + sequenceId);
            continue;
        }

        // Message .event

        var sequence = configData["sequence"][sequenceId];

        var eventData = {
            bot: bot,
            message: message,
            captures: captures,
            sequenceId: sequenceId,
            knowledgeType: knowledgeType,
            // Helper data
            config: configData,
            // Helper functions
            buildSentence: buildSentence,
            responseForError: responseForError,
            triggerSequence: triggerSequence
        };

        cont = true;
        eventInterceptors["on_event"].forEach(function(interceptor){
            var result = interceptor(eventData);
            if(typeof(result) != "boolean" || !result){
                cont = result;
                return;
            }
        });
        if(typeof(cont) != "boolean" || !cont){
            if(typeof(cont) == "boolean"){
                console.log("Skipped by extension.onEvent");
                continue;
            }else{
                console.log("Stopped by extension.onEvent");
                return;
            }
        }

        if(typeof(sequence) == "function"){
            sequence(eventData);
        }else{
            triggerSequence(eventData);
        }

        cont = true;
        eventInterceptors["post_event"].forEach(function(interceptor){
            var result = interceptor(eventData);
            if(typeof(result) != "boolean" || !result){
                cont = result;
                return;
            }
        });
        if(typeof(cont) != "boolean" || !cont){
            if(typeof(cont) == "boolean"){
                console.log("Continue by extension.postEvent");
                continue;
            }else{
                console.log("Stopped by extension.postEvent");
                return;
            }
        }

        return;
    }
}

controller.hears(
    ["reload"],
    "direct_message,direct_mention,mention",
    function(bot, message){
        reloadSequence();
    }
);

controller.hears(
    ["shutdown"],
    "direct_message,direct_mention,mention",
    function(bot, message){
        bot.reply(message, "Bye!");
        process.exit();
    }
);

controller.hears(
    ["."],
    "direct_message,direct_mention,mention",
    interceptMessage
);
