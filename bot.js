/*
* @Author: spywhere
* @Date:   2016-01-14 21:36:44
* @Last Modified by:   Sirisak Lueangsaksri
* @Last Modified time: 2016-01-15 14:34:50
*/

var fs = require("fs");

var configData = JSON.parse(
    fs.readFileSync(
        "config.json", "utf8"
    ).replace(/\s\/\/.*(?=\n)|\s\/\/.*$/g, "")
);

Object.prototype.extends = function(obj){
    if(typeof(obj) != "object"){
        return this;
    }
    for(var key in obj){
        this[key] = obj[key];
    }
    return this;
}

function buildSentence(sentences, dictionary){
    var sentence = sentences[Math.floor(Math.random() * sentences.length)];
    var generatedDictionary = {};
    for(var word in dictionary){
        var words = dictionary[word];
        if(typeof(words) == "object"){
            generatedDictionary[word] = words[Math.floor(Math.random() * words.length)];
        }else{
            generatedDictionary[word] = words;
        }
    }
    function dictionaryWord(macro, word){
        if(word in generatedDictionary){
            return generatedDictionary[word];
        }
        return "";
    }
    return sentence.replace(/<(\w+)>/gi, dictionaryWord);
}

var Botkit = require("botkit");
var exec = require("child_process").exec;
var path = require("path");

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

function getBuildQueueInfo(){
    var info = {
        "names": "Nothing",
        "currentQueue": "Nothing"
    };
    var names = "";
    for(var index=0;index<buildQueue.length;index++){
        var build = buildQueue[index];
        var buildInfo = configData["build_info"][build["env"]];
        if(index == 0){
            info["currentQueue"] = buildInfo["name"];
        }
        if(names){
            if(index == buildQueue.length - 1){
                names += " and ";
            }else{
                names += ", ";
            }
        }
        names += buildInfo["name"];
    }
    info["totalQueue"] = "" + buildQueue.length;
    if(names){
        info["names"] = names;
    }
    return info;
}

function getBuildStatus(env){
    if(buildQueue.length <= 0){
        return "no";
    }
    for(var index=0;index<buildQueue.length;index++){
        var build = buildQueue[index];
        if(build["env"] == env){
            return (index == 0) ? "env_building" : "env_queue";
        }
    }
    return "no";
}

function runBuild(callback, sequence, currentSequence, processResult){
    if(!sequence){
        var build = buildQueue[0];

        if(build["env"] in configData["build_sequence"]){
            var sequence = configData["build_sequence"][build["env"]];
            runBuild(callback, sequence, 0);
            return;
        }
    }else{
        if(currentSequence < sequence["command"].length){
            if(processResult && processResult["error"]){
                console.log("And it's internal failed: " + processResult["error"]);
                callback({
                    "success": false,
                    "error_type": "process_failed"
                });
                buildQueue.shift();
                return;
            }
            if(currentSequence > 0){
                console.log("And it's succeed");
            }

            var command = sequence["command"][currentSequence];
            var commandCallback = (function(callback, sequence, currentSequence){
                return function(error, stdout, stderr){
                    runBuild(callback, sequence, currentSequence+1, {
                        "stdout": stdout,
                        "stderr": stderr,
                        "error": error
                    });
                }
            })(callback, sequence, currentSequence);

            var working_dir = ".";
            if("working_dir" in configData["config"]){
                working_dir = configData["config"]["working_dir"];
            }

            console.log("Runing: " + command);
            exec(command, {
                "cwd": working_dir
            }, commandCallback);
            return;
        }else{
            buildQueue.shift();

            var result = {};
            var working_dir = ".";
            if("working_dir" in configData["config"]){
                working_dir = configData["config"]["working_dir"];
            }
            if("output" in sequence){
                if(typeof(sequence["output"]) == "boolean" && sequence["output"]){
                    result = JSON.parse(processResult["stdout"]);
                }else if(typeof(sequence["output"]) == "string"){
                    var output_file = path.join(working_dir, sequence["output"]);
                    try{
                        fs.accessSync(output_file);
                        result = JSON.parse(
                            fs.readFileSync(
                                output_file, "utf8"
                            ).replace(/\s\/\/.*(?=\n)|\s\/\/.*$/g, "")
                        );
                    }catch(error){
                        console.log("And it's external failed");
                        callback({
                            "success": false,
                            "error_type": "output_not_found"
                        });
                        return;
                    }
                }
            }

            if(processResult["error"]){
                console.log("And it's internal failed: " + processResult["error"]);
                callback({
                    "success": false,
                    "error_type": "process_failed"
                });
                return;
            }else{
                if("error" in result){
                    console.log("And it's external failed");
                    callback({
                        "success": false,
                        "error_type": "output_error",
                        "data": result
                    });
                }else{
                    console.log("And it's succeed");
                    callback({
                        "success": true,
                        "data": result
                    });
                }
            }
            return;
        }
    }
}

function triggerBuild(message, env, type, triggerType){
    var environment = env.toLowerCase();
    if(!(environment in configData["build_info"])){
        return {
            "building": false,
            "message": buildSentence(
                configData["error_code"]["env_not_found"]["answer"],
                {}.extends(
                    configData["error_code"]["env_not_found"]["dictionary"]
                ).extends(
                    {
                        "env": env
                    }
                )
            )
        };
    }

    var isTrigger = (triggerType == "public" || triggerType == "private");

    if(triggerType == "public"){
        var skip = false;
        var channels = configData["build_info"][environment]["notify_publicly"];
        for(var index=0;index<channels.length;index++){
            if(message.channel == channels[index].channel){
                skip = true;
                break;
            }
        }
        if(!skip){
            channels.push(message);
        }
    }else if(triggerType == "private"){
        var skip = false;
        var channels = configData["build_info"][environment]["notify_privately"];
        for(var index=0;index<channels.length;index++){
            if(message.user == channels[index].user){
                skip = true;
                break;
            }
        }
        if(!skip){
            channels.push(message);
        }
    }
    var buildStatus = getBuildStatus(environment)
    var info = configData["build_info"][environment];
    var queueInfo = getBuildQueueInfo();
    if(buildStatus != "no" && isTrigger){
        return {
            "building": false,
            "message": buildSentence(
                configData["error_code"][buildStatus]["answer"],
                {}.extends(
                    configData["error_code"][buildStatus]["dictionary"]
                ).extends(
                    {
                        "env": env
                    }
                ).extends(
                    queueInfo
                ).extends(
                    info
                )
            )
        };
    }

    if(isTrigger){
        buildQueue.push({
            "env": environment
        });
        runBuild((function(environment, type, info){
            return function(buildResult){
                var completionMessage = null;
                if(buildResult["success"]){
                    completionMessage = buildSentence(
                        configData["knowledge"][type]["responses"],
                        {}.extends(
                            configData["knowledge"][type]["dictionary"]
                        ).extends(
                            {
                                "env": environment
                            }
                        ).extends(
                            queueInfo
                        ).extends(
                            info
                        ).extends(
                            buildResult["data"]
                        )
                    );
                }else{
                    if(buildResult["error_type"] == "output_error"){
                        completionMessage = buildSentence(
                            configData["error_code"][buildResult["error_type"]]["answer"],
                            {}.extends(
                                configData["error_code"][buildResult["error_type"]]["dictionary"]
                            ).extends(
                                {
                                    "env": env
                                }
                            ).extends(
                                queueInfo
                            ).extends(
                                info
                            ).extends(
                                buildResult["data"]
                            )
                        );
                    }else if(
                        buildResult["error_type"] in configData["error_code"] &&
                        "answer" in configData["error_code"][buildResult["error_type"]]
                    ){
                        completionMessage = buildSentence(
                            configData["error_code"][buildResult["error_type"]]["answer"],
                            {}.extends(
                                configData["error_code"][buildResult["error_type"]]["dictionary"]
                            ).extends(
                                {
                                    "env": env
                                }
                            ).extends(
                                queueInfo
                            ).extends(
                                info
                            )
                        );
                    }
                }
                if(completionMessage){
                    configData["build_info"][environment]["notify_publicly"].forEach(function(message){
                        bot.reply(message, completionMessage);
                    });
                    configData["build_info"][environment]["notify_privately"].forEach(function(message){
                        bot.reply(message, completionMessage);
                    });
                    configData["build_info"][environment]["notify_publicly"] = [];
                    configData["build_info"][environment]["notify_privately"] = [];
                }
            }
        })(environment, type, info));
    }else{
        var completionMessage = buildSentence(
            configData["knowledge"][type]["responses"],
            {}.extends(
                configData["knowledge"][type]["dictionary"]
            ).extends(
                {
                    "env": environment
                }
            ).extends(
                queueInfo
            ).extends(
                info
            )
        );
        bot.reply(message, completionMessage);
    }

    return {
        "building": true
    };
}

for(var buildType in configData["knowledge"]){
    var buildKnowledge = configData["knowledge"][buildType];
    if(!("patterns" in buildKnowledge && "responses" in buildKnowledge)){
        continue;
    }
    buildKnowledge["patterns"].forEach(function(pattern){
        if(!("question" in pattern)){
            return;
        }

        var scope = "direct_message,direct_mention,mention";
        var triggerType = "public";
        if("trigger_type" in buildKnowledge){
            triggerType = buildKnowledge["trigger_type"];
        }

        if(triggerType == "public"){
            scope = "direct_mention,mention";
        }else if(triggerType == "private"){
            scope = "direct_message";
        }

        controller.hears(
            pattern["question"],
            scope,
            (function(buildKnowledge, pattern, buildType, triggerType){
                return function(bot, message){
                    var match = null;
                    var capture = [];
                    for(var index=0;index<pattern["question"].length;index++){
                        var question = pattern["question"][index];
                        match = message.text.match(new RegExp(question, "i"));
                        if(match){
                            if(
                                "capture" in pattern &&
                                index < pattern["capture"].length
                            ){
                                capture = pattern["capture"][index];
                            }
                            break;
                        }
                    }
                    var captures = {};
                    for(var index=0;index<capture.length;index++){
                        if(capture[index]){
                            captures[capture[index]] = match[index];
                        }
                    }
                    if(!("env" in captures)){
                        if("responses" in configData["knowledge"][buildType]){
                            bot.reply(message, buildSentence(
                                configData["knowledge"][buildType]["responses"],
                                {}.extends(
                                    configData["knowledge"][buildType]["dictionary"]
                                ).extends(
                                    getBuildQueueInfo()
                                )
                            ));
                        }
                        return;
                    }

                    var env = captures["env"];
                    var buildResponse = triggerBuild(message, env, buildType, triggerType);
                    if(buildResponse["building"]){
                        if(
                            "queue_answer" in pattern &&
                            getBuildStatus(env) == "env_queue"
                        ){
                            bot.reply(message, buildSentence(
                                pattern["queue_answer"],
                                {}.extends(
                                    buildKnowledge["dictionary"]
                                ).extends(
                                    configData["build_info"][
                                        buildQueue[buildQueue.length - 2]["env"]
                                    ]
                                ).extends(
                                    getBuildQueueInfo()
                                ).extends(
                                    captures
                                )
                            ));
                        }else if("answer" in pattern){
                            bot.reply(message, buildSentence(
                                pattern["answer"],
                                {}.extends(
                                    buildKnowledge["dictionary"]
                                ).extends(
                                    getBuildQueueInfo()
                                ).extends(
                                    configData["build_info"][env]
                                ).extends(
                                    captures
                                )
                            ));
                        }
                    }else{
                        bot.reply(message, buildResponse["message"]);
                    }
                }
            })(buildKnowledge, pattern, buildType, triggerType)
        );
    });
}

controller.hears(
    ["shutdown"],
    "direct_message,direct_mention,mention",
    function(bot, message){
        bot.reply(message, "Bye!");
        process.exit();
    }
);
