/*
* @Author: spywhere
* @Date:   2016-01-14 21:36:44
* @Last Modified by:   Sirisak Lueangsaksri
* @Last Modified time: 2016-01-25 17:10:20
*/

var decache = require("decache");
var fs = require("fs");
var moment = require("moment");
var yaml = require("js-yaml");
var powerOff = require("power-off");
var sleepMode = require("sleep-mode");
var isOnline = require("is-online");

var Botkit = require("botkit");
var exec = require("child_process").exec;
var path = require("path");

var bot = null;
var firstLaunch = true;
var running = false;
var cacheKeys;
var dataChanged = false;
var storageData = {};
var configData;
var sequenceQueue = [];
var extensions;
var extensionsLoaded = {
};

var workingDirSuffix = "";

var presetCommands;

function resetSettings(){
    cacheKeys = {};
    configData = {};
    extensions = {
        pre_event: [],
        on_event: [],
        post_event: [],
        on_failed: [],
        response_info: []
    };

    presetCommands = [
        {
            "pattern": /^\s*cd\s+(.+)/i,
            "operation": changeWorkingDirectory
        }, {
            "pattern": /^\s*cancel\s*(.+)/i,
            "operation": cancelSequence
        }, {
            "pattern": /^\s*reload\s*(.+)?/i,
            "operation": reloadSequence
        }, {
            "pattern": /^\s*shutdown/i,
            "operation": shutdownSequence
        }, {
            "pattern": /^\s*save_data/i,
            "operation": saveStorageData
        }, {
            "pattern": /^\s*shutdown_computer/i,
            "operation": shutdownComputer
        }, {
            "pattern": /^\s*sleep_computer/i,
            "operation": sleepComputer
        }
    ];
}

Object.defineProperty(Object.prototype, "extends", {
    enumerable: false,
    value: function(obj, rootOnly){
        if(typeof(obj) !== "object"){
            return this;
        }
        for(var key in obj){
            if(key in this && Array.isArray(obj[key]) && !rootOnly){
                this[key].concat(obj[key]);
            }else if(
                key in this && typeof(obj[key]) === "object" && !rootOnly
            ){
                this[key].extends(obj[key]);
            }else{
                this[key] = obj[key];
            }
        }
        return this;
    }
});

function logMessage(message){
    console.log(moment().format("DD-MMM-YYYY HH:mm:ss ") + message);
}

function loadStorageData(){
    var fileExists;
    try{
        fs.accessSync(configData.config.storage_file, fs.R_OK);
        fileExists = true;
    }catch(exception){
        fileExists = false;
    }
    try{
        if(fileExists){
            storageData = yaml.safeLoad(
                fs.readFileSync(configData.config.storage_file, {
                    json: true
                }).toString()
            );
            logMessage("Storage data loaded");
        }

        var saveInterval = 60000;
        if("save_interval" in configData.config){
            saveInterval = configData.config.save_interval;
        }
        setInterval(saveStorageData, saveInterval);
        logMessage(
            "Storage data will save on every " +
            (saveInterval / 1000).toFixed(3) +
            " seconds"
        );
    }catch(exception){
        logMessage(
            "Error while loading storage file. Will try again in 3 seconds..."
        );
        setTimeout(loadStorageData, 3000);
    }
}

function saveStorageData(callback){
    if(!dataChanged){
        return;
    }
    fs.writeFile(configData.config.storage_file, yaml.safeDump(storageData, {
        skipInvalid: true
    }), "utf8", function(error){
        if(error){
            logMessage("Error while saving storage data");
            return;
        }
        dataChanged = false;
        logMessage("Storage data saved");
        if(callback){
            callback();
        }
    });
}

function queryValue(sourceData, data, query, prefix){
    if(query === undefined || query === null || query === ""){
        return data;
    }
    query = buildSentence([query], sourceData);
    var splitPoint = query.indexOf(".");
    var key = query;

    if(splitPoint < 0){
        splitPoint = key.length;
    }else{
        key = key.substring(0, splitPoint);
    }

    if(!prefix){
        prefix = key;
    }else{
        prefix += "." + key;
    }

    var storeKey = false;
    if(key === "^"){
        if(prefix in cacheKeys){
            key = cacheKeys[prefix];
        }else{
            storeKey = true;
            key = "*";
        }
    }

    if(Array.isArray(data)){
        if(data.length <= 0){
            return null;
        }
        if(key !== "*" && /^(-?\d+)$/.test(key)){
            key = Number(key);
        }else if(key === "*"){
            key = Math.floor(Math.random() * data.length);
            if(storeKey){
                cacheKeys[prefix] = key;
            }
            return queryValue(
                sourceData,
                data[key],
                query.substring(splitPoint + 1),
                prefix
            );
        }else{
            // Missing value for specified key
            return null;
        }
        if(key < -data.length || data.length <= key){
            // Missing value for specified key
            return null;
        }else{
            if(key < 0){
                key += data.length;
            }
            return queryValue(
                sourceData,
                data[key],
                query.substring(splitPoint + 1),
                prefix
            );
        }
    }else if(typeof(data) === "object"){
        if(key !== "*" && !(key in data)){
            // Missing value for specified key
            return null;
        }else if(key === "*"){
            var keys = Object.keys(data);
            key = keys[Math.floor(Math.random() * keys.length)];
            if(storeKey){
                cacheKeys[prefix] = key;
            }
        }
        return queryValue(
            sourceData,
            data[key],
            query.substring(splitPoint + 1),
            prefix
        );
    }else{
        return data;
    }
}

function buildSentence(sentences, dictionary){
    var sentence = sentences[Math.floor(Math.random() * sentences.length)];
    cacheKeys = {};

    function dictionaryWord(
        macro, query, t2, t3 ,t4, t5, t6, t7, t8, t9,
        defaultValue, t11, tags
    ){
        var dateTimePoint = macro.indexOf("date_time");
        var output = null;
        if(dateTimePoint === 1){
            output = moment().valueOf();
        }else{
            output = queryValue(dictionary, dictionary, query);
        }
        if(output === null){
            if(defaultValue){
                output = defaultValue;
            }else{
                output = "";
            }
        }
        if(typeof(output) === "object"){
            output = JSON.stringify(output);
        }
        output = "" + output;
        var willLower = true;
        if(tags){
            tags.toLowerCase().split(",").forEach(function(tag){
                var valuePoint = tag.indexOf("=");
                var value = undefined;
                if(valuePoint > 0){
                    value = tag.substring(valuePoint + 1);
                    tag = tag.substring(0, valuePoint);
                }
                willLower = false;
                if(tag === "upper"){
                    output = output.toUpperCase();
                }else if(tag === "lower"){
                    output = output.toLowerCase();
                }else if(tag === "timestamp_format"){
                    var numberValue = parseFloat(output);
                    if(!isNaN(numberValue) && isFinite(numberValue)){
                        output = moment(numberValue).format(value);
                    }
                }else if(tag === "duration_format"){
                    var numberValue = parseFloat(output);
                    if(!isNaN(numberValue) && isFinite(numberValue)){
                        output = moment(numberValue * 1000).format(value);
                    }
                }
            });
        }
        if(willLower){
            return output.toLowerCase();
        }else{
            return output;
        }
    }
    var pattern = new RegExp(
        "<((\\w+|\\*|\\^|<([^>](>?[^>])*)>)" +
        "(\\.(\\w+|\\*|\\^|<([^>](>?[^>])*?)>))*)(=([^:>]*))?" +
        "(:(([^,>]+)(,[^,>]+)*))?>",
        "g"
    );
    return sentence.replace(
        pattern,
        dictionaryWord
    );
}

function changeWorkingDirectory(matches){
    if(matches.length > 1){
        workingDirSuffix = path.resolve(workingDirSuffix, matches[1]);
    }
    return {};
}

function reloadSequence(matches){
    resetSettings();
    try{
        configData = {};
        logMessage("Loading config.yaml...");
        configData = yaml.safeLoad(
            fs.readFileSync("config.yaml", "utf8")
        , {
            json: true
        });
        // Load extensions
        if(
            matches.indexOf("--no-extensions") === -1 &&
            "config" in configData &&
            "extensions" in configData.config
        ){
            configData.config.extensions.forEach(
                function(extensionPath){
                    logMessage("Loading extension " + extensionPath + "...");
                    if(
                        extensionPath in extensionsLoaded &&
                        extensionsLoaded[extensionPath]
                    ){
                        delete require.cache[require.resolve(extensionPath)]
                        extensionsLoaded[extensionPath] = false;
                    }
                    var extension = require(extensionPath);
                    extensionsLoaded[extensionPath] = true;

                    if("preEvent" in extension){
                        extensions.pre_event.push(extension.preEvent);
                    }
                    if("onEvent" in extension){
                        extensions.on_event.push(extension.onEvent);
                    }
                    if("postEvent" in extension){
                        extensions.post_event.push(extension.postEvent);
                    }
                    if("onFailed" in extension){
                        extensions.on_failed.push(extension.onFailed);
                    }
                    if("getResponseInfo" in extension){
                        extensions.response_info.push(
                            extension.getResponseInfo
                        );
                    }
                    if("config" in extension){
                        configData = configData.extends(
                            extension.config
                        );
                    }
                    if("commands" in extension){
                        presetCommands = presetCommands.extends(
                            extension.commands
                        );
                    }
                }
            );
        }
        // Load additional configs
        if(
            "config" in configData &&
            "additional_configs" in configData.config
        ){
            configData.config.additional_configs.forEach(
                function(configFile){
                    logMessage("Loading " + configFile + "...");
                    configData = configData.extends(
                        yaml.safeLoad(
                            fs.readFileSync(configFile, {
                                json: true
                            }).toString()
                        )
                    );
                }
            );
        }
    }catch(err){
        logMessage("Error while loading: " + err);
        return {
            stdout: "",
            stderr: "",
            error: "Error while loading: " + err,
            internal: "terminate"
        };
    }
    return {
        internal: "terminate"
    };
}

function shutdownComputer(matches){
    saveStorageData(function(){
        powerOff();
    });
    return {};
}

function sleepComputer(matches){
    saveStorageData(function(){
        sleepMode();
    });
    return {};
}

function shutdownSequence(matches){
    saveStorageData(function(){
        process.exit();
    });
    return {};
}

function cancelSequence(matches){
    if(matches.length > 1){
        var sequenceIds = matches[1].split("\\s+");
        var index = 0;
        while(index < sequenceQueue.length){
            var sequenceInfo = sequenceQueue[index];
            if(sequenceIds.indexOf(sequenceInfo.sequenceId) >= 0){
                sequenceInfo.process.kill();
                sequenceInfo.is_cancel = true;
                sequenceQueue.splice(index, 1);
            }else{
                index++;
            }
        }
    }
    return {};
}

function getResponseInfo(eventData){
    var info = {};

    if(eventData){
        info.message = eventData.message;

        info.config = eventData.config;

        if("knowledgeType" in eventData){
            info.knowledge_type = eventData.knowledgeType;
        }

        // Queue Info
        info.run_time = storageData.run_time;

        if(sequenceQueue.length > 0){
            info.queue = {};

            var runningSequences = [];
            var queuingSequences = [];
            var queueSequences = [];
            sequenceQueue.forEach(function(sequenceData){
                // All queue
                queueSequences.push(
                    sequenceData.sequenceId
                );

                if("is_running" in sequenceData && sequenceData.is_running){
                    // Running sequence
                    runningSequences.push(
                        sequenceData.sequenceId
                    );
                }else{
                    // Queuing sequence
                    queuingSequences.push(
                        sequenceData.sequenceId
                    );
                }
            });

            if(runningSequences){
                info.queue.running_sequences = runningSequences;
            }
            if(queuingSequences){
                info.queue.queuing_sequences = queuingSequences;
            }
            if(queueSequences){
                info.queue.queue_sequences = queueSequences;
            }
        }

        if("sequenceId" in eventData){
            var preceedingSequence = null;
            var currentInQueue = false;
            sequenceQueue.forEach(function(sequenceData){
                if(sequenceData.sequenceId === eventData.sequenceId){
                    currentInQueue = true;
                    return;
                }
                preceedingSequence = sequenceData.sequenceId;
            });

            if("config" in eventData && "sequence_info" in eventData.config){
                // Parallel Info
                if(
                    currentInQueue &&
                    preceedingSequence &&
                    preceedingSequence in eventData.config.sequence_info
                ){
                    info.parallel_sequence = eventData.config.sequence_info[
                        preceedingSequence
                    ];
                }

                // Current Sequence Info
                if("startTime" in eventData){
                    info.sequence_time = {
                        "start_time": eventData.startTime.valueOf(),
                        "elapse_time": moment(
                            moment().diff(eventData.startTime)
                        ).valueOf()
                    };
                }else{
                    sequenceQueue.forEach(function(sequenceInfo){
                        if(sequenceInfo.sequenceId === eventData.sequenceId){
                            info.sequence_time = {
                                "start_time": sequenceInfo.startTime.valueOf(),
                                "elapse_time": moment(
                                    moment().diff(sequenceInfo.startTime)
                                ).valueOf()
                            };
                            return;
                        }
                    });
                }
                if(eventData.sequenceId in eventData.config.sequence_info){
                    var sequenceId = eventData.sequenceId;
                    info.sequence = eventData.config.sequence_info[
                        sequenceId
                    ];
                }
                if(currentInQueue && preceedingSequence){
                    info.sequence_can_parallel = sequenceCanParallel(
                        eventData.config.sequence[eventData.sequenceId],
                        preceedingSequence
                    );
                }
            }

            info.sequence_id = eventData.sequenceId;
        }

        // Captures Info
        if("captures" in eventData){
            info.captures = eventData.captures;
        }
    }

    extensions.response_info.forEach(function(responseInfo){
        info.extends(responseInfo(eventData));
    });
    return info;
}

function hasResponseForError(errorCode){
    return (
        "error_code" in configData &&
        errorCode in configData.error_code &&
        "answers" in configData.error_code[errorCode]
    );
}

function responseForError(errorCode, errorData){
    if(!hasResponseForError(errorCode)){
        logMessage("No response for error code: " + errorCode);
        return null;
    }
    var errorResponse = configData.error_code[errorCode];
    return buildSentence(
        errorResponse.answers,
        getResponseInfo(errorData).extends(
            ("dictionary" in errorResponse) ? errorResponse.dictionary : {}
        )
    );
}

function sequenceCanParallel(sequence, lastSequence){
    if(!("parallel" in sequence)){
        return null;
    }

    if(typeof(sequence.parallel) === "boolean"){
        return sequence.parallel;
    }else if(
        typeof(sequence.parallel) === "object" &&
        (
            "allows" in sequence.parallel ||
            "disallows" in sequence.parallel
        )
    ){
        var allow;
        if("disallows" in sequence.parallel){
            allow = true;
            sequence.parallel.disallows.forEach(function(pattern){
                if(lastSequence.match("^" + pattern + "$")){
                    allow = false;
                    return;
                }
            });
            return allow;
        }
        if("allows" in sequence.parallel){
            allow = false;
            sequence.parallel.allows.forEach(function(pattern){
                if(lastSequence.match("^" + pattern + "$")){
                    allow = true;
                    return;
                }
            });
            return allow;
        }
    }
    return true;
}

function handleProcess(sequenceInfo, buildResult){
    logMessage("[" + sequenceInfo.sequenceId + "] Response based on result");

    var eventData = sequenceInfo.eventData;
    var knowledge = configData.knowledge[eventData.knowledgeType];

    var completionMessage = null;
    if(buildResult["success"]){
        completionMessage = buildSentence(
            knowledge["responses"],
            getResponseInfo(eventData).extends(
                knowledge["dictionary"]
            ).extends(
                buildResult["data"]
            )
        );
    }else{
        completionMessage = responseForError(
            buildResult["error_type"],
            eventData
        );
        eventData.error = buildResult["error_type"];
        extensions.on_failed.forEach(function(interceptor){
            var result = interceptor(eventData);
            if(typeof(result) !== "boolean" || !result){
                return;
            }
        });
    }
    if(completionMessage){
        sequenceInfo.notify.forEach(function(message){
            bot.reply(message, completionMessage);
        });
        sequenceInfo.notify = [];
    }
}

function collectSequenceElapseTime(elapseTime, sequenceId){
    if(!("run_time" in storageData)){
        storageData.run_time = {
            minimum: {},
            average: {},
            maximum: {}
        };
    }
    // Global Statistics
    elapseTime = elapseTime.valueOf();
    if("*" in storageData.run_time.minimum){
        if(elapseTime < storageData.run_time.minimum["*"]){
            storageData.run_time.minimum["*"] = elapseTime;
        }
    }else{
        storageData.run_time.minimum["*"] = elapseTime;
    }
    if("*" in storageData.run_time.average){
        storageData.run_time.average["*"] += elapseTime;
        storageData.run_time.average["*"] /= 2;
    }else{
        storageData.run_time.average["*"] = elapseTime;
    }
    if("*" in storageData.run_time.maximum){
        if(elapseTime > storageData.run_time.maximum["*"]){
            storageData.run_time.maximum["*"] = elapseTime;
        }
    }else{
        storageData.run_time.maximum["*"] = elapseTime;
    }
    // Sequence Statistics
    if(sequenceId in storageData.run_time.minimum){
        if(elapseTime < storageData.run_time.minimum[sequenceId]){
            storageData.run_time.minimum[sequenceId] = elapseTime;
        }
    }else{
        storageData.run_time.minimum[sequenceId] = elapseTime;
    }
    if(sequenceId in storageData.run_time.average){
        storageData.run_time.average[sequenceId] += elapseTime;
        storageData.run_time.average[sequenceId] /= 2;
    }else{
        storageData.run_time.average[sequenceId] = elapseTime;
    }
    if(sequenceId in storageData.run_time.maximum){
        if(elapseTime > storageData.run_time.maximum[sequenceId]){
            storageData.run_time.maximum[sequenceId] = elapseTime;
        }
    }else{
        storageData.run_time.maximum[sequenceId] = elapseTime;
    }
    dataChanged = true;
}

function runSequence(sequenceInfo, currentCommand, processResult){
    if(sequenceQueue.length <= 0){
        logMessage("[DEBUG] End queue");
        return;
    }
    var sequence = {};
    if(!sequenceInfo){
        var taskIndex = null;
        for(var index in sequenceQueue){
            index = parseInt(index, 10);
            if(
                "is_running" in sequenceQueue[index] &&
                sequenceQueue[index].is_running
            ){
                continue;
            }
            sequence = configData.sequence[
                sequenceQueue[index].sequenceId
            ];
            if(
                index === 0 ||
                (
                    index > 0 &&
                    sequenceCanParallel(
                        sequence,
                        sequenceQueue[index - 1].sequenceId
                    )
                )
            ){
                taskIndex = index;
                break;
            }
        }
        if(taskIndex === null){
            logMessage("[DEBUG] No sequence can be parallel");
            return;
        }
        sequenceInfo = sequenceQueue[taskIndex];
        sequenceInfo.is_running = true;
    }

    var eventData = sequenceInfo.eventData;
    var sequenceId = eventData.sequenceId;
    if(sequenceId){
        sequence = configData.sequence[sequenceId];
    }

    if(!currentCommand){
        eventData.startTime = moment();
        sequenceInfo.startTime = moment();
        workingDirSuffix = "";
        currentCommand = 0;
    }

    if(!("commands" in sequence)){
        var response = responseForError("cmd_not_found", eventData);

        eventData.error = "cmd_not_found";
        extensions.on_failed.forEach(function(interceptor){
            var result = interceptor(eventData);
            if(typeof(result) !== "boolean" || !result){
                return;
            }
        });

        if(response){
            bot.reply(eventData.message, response);
        }
        return;
    }

    var workingDir = ".";
    if("working_dir" in sequence){
        workingDir = sequence.working_dir;
    }else if("working_dir" in configData.config){
        workingDir = configData.config.working_dir;
    }
    workingDir = path.resolve(workingDir, workingDirSuffix);

    if(currentCommand >= sequence.commands.length){
        var elapseTime = moment(moment().diff(sequenceInfo.startTime));
        for(var index in sequenceQueue){
            if(
                sequenceQueue[index].sequenceId === sequenceId &&
                "is_running" in sequenceQueue[index] &&
                sequenceQueue[index].is_running
            ){
                sequenceQueue.splice(index, 1);
                break;
            }
        }

        var result = {};
        if("output" in sequence){
            if(typeof(sequence.output) === "boolean"){
                if(sequence.output){
                    result = yaml.safeLoad(processResult.stdout, {
                        json: true
                    });
                }else{
                    result.output = processResult.stdout;
                }
            }else if(typeof(sequence.output) === "string"){
                var output_file = path.join(workingDir, sequence.output);
                try{
                    fs.accessSync(output_file);
                    result.output = yaml.safeLoad(
                        fs.readFileSync(output_file, "utf8"),
                        {
                            json: true
                        }
                    );
                }catch(error){
                    logMessage(
                        "[" + sequenceId +
                        "] And it's external failed (output_not_found)"
                    );
                    handleProcess(sequenceInfo, {
                        success: false,
                        error_type: "output_not_found"
                    });
                    logMessage(
                        "[" + sequenceId + "] Finished in " +
                        elapseTime.format("m:ss.SSS")
                    );
                    collectSequenceElapseTime(elapseTime, sequenceId);
                    runSequence();
                    return;
                }
            }
        }

        if(processResult.error){
            logMessage(
                "[" + sequenceId + "] And it's internal failed: " +
                processResult.error
            );
            handleProcess(sequenceInfo, {
                success: false,
                error_type: "process_failed"
            });
        }else{
            if("error" in result){
                logMessage(
                    "[" + sequenceId +
                    "] And it's external failed (output_error)"
                );
                handleProcess(sequenceInfo, {
                    success: false,
                    error_type: "output_error",
                    data: result
                });
            }else{
                logMessage("[" + sequenceId + "] And it's succeed");
                handleProcess(sequenceInfo, {
                    success: true,
                    data: result
                });
            }
        }
        logMessage(
            "[" + sequenceId + "] Finished in " +
            elapseTime.format("m:ss.SSS")
        );
        collectSequenceElapseTime(elapseTime, sequenceId);
        runSequence();
        return;
    }
    if(currentCommand > 0){
        logMessage("[" + sequenceId + "] And it's succeed");
    }

    var command = buildSentence(
        [sequence.commands[currentCommand]], getResponseInfo(eventData)
    );
    var commandCallback = (function(sequenceInfo, currentCommand){
        return function(error, stdout, stderr, internal){
            if("is_cancel" in sequenceInfo && sequenceInfo.is_cancel){
                logMessage(
                    "[" + sequenceInfo.sequenceId +
                    "] Sequence has been cancelled"
                );
                return;
            }
            runSequence(sequenceInfo, currentCommand+1, {
                stdout: stdout,
                stderr: stderr,
                error: error,
                internal: internal
            });
        };
    })(sequenceInfo, currentCommand);

    logMessage(
        "[" + sequenceId + "] Working Directory: " + path.normalize(workingDir)
    );

    logMessage("[" + sequenceId + "] Running: " + command);
    var commandResult = null;
    presetCommands.forEach(function(commandInfo){
        var match = command.match(commandInfo.pattern);
        if(match){
            commandResult = commandInfo.operation(match);
            return;
        }
    });
    if(commandResult){
        commandCallback(
            ("error" in commandResult) ? commandResult.error : null,
            ("stdout" in commandResult) ? commandResult.stdout : null,
            ("stderr" in commandResult) ? commandResult.stderr : null,
            ("internal" in commandResult) ? commandResult.internal : null
        );
    }else{
        sequenceInfo.process = exec(command, {
            cwd: path.normalize(workingDir)
        }, commandCallback);
    }
    return;
}

function triggerSequence(eventData){
    var message = eventData.message;
    var sequenceId = eventData.sequenceId;

    var sequence = configData.sequence[sequenceId];
    if(sequenceQueue.length > 0){
        var errorCode = null;
        if(
            hasResponseForError("seq_parallel_wait") &&
            "notify_parallel" in sequence
        ){
            errorCode = "seq_parallel_wait";
        }
        var lastSequence = sequenceQueue[sequenceQueue.length - 1].sequenceId;
        var canParallel = sequenceCanParallel(sequence, lastSequence);
        if(canParallel === null){
            canParallel = false;
            if(
                hasResponseForError("seq_running") &&
                "notify_running" in sequence
            ){
                errorCode = "seq_running";
            }else{
                errorCode = "seq_queue_wait";
            }
        }
        if(!canParallel){
            sequenceQueue.forEach(function(sequenceInfo){
                if(sequenceInfo.sequenceId === sequenceId){
                    var willAdd = true;
                    for(var index in sequenceInfo.notify){
                        if(sequenceInfo.notify[index].user === message.user){
                            willAdd = false;
                            break;
                        }
                    }
                    if(willAdd){
                        sequenceInfo.notify.push(message);
                    }
                    return true;
                }
            });

            var response = responseForError(errorCode, eventData);

            extensions.on_failed.forEach(function(interceptor){
                var result = interceptor(eventData);
                if(typeof(result) !== "boolean" || !result){
                    return false;
                }
            });

            if(response){
                bot.reply(message, response);
            }
            return "answer_on_parallel" in sequence;
        }
    }

    var sequenceInfo = {
        sequenceId: sequenceId,
        eventData: eventData,
        notify: [message]
    };
    sequenceQueue.push(sequenceInfo);
    runSequence();
    return true;
}

function interceptMessage(bot, message){
    var knowledges = {};
    if("knowledge" in configData){
        knowledges = configData.knowledge;
    }
    for(var knowledgeType in knowledges){
        var knowledge = knowledges[knowledgeType];
        var pattern = {};
        if("pattern" in knowledge){
            pattern = knowledge.pattern;
        }
        // Questions not in the pattern
        if(!("questions" in pattern)){
            continue;
        }
        var questions = pattern.questions;
        var match = null;
        var captureNames = [];
        for(var index=0;index < questions.length;index++){
            captureNames = [];
            var question = questions[index];

            match = message.text.match(new RegExp(question, "i"));
            if(match){
                if(
                    "captures" in pattern &&
                    index < pattern.captures.length
                ){
                    captureNames = pattern.captures[index];
                }
                break;
            }
        }
        // No question matched
        if(!match){
            continue;
        }
        var captures = {};
        for(var index=0;index < captureNames.length;index++){
            if(captureNames[index]){
                captures[captureNames[index]] = match[index];
            }
        }

        var cont = true;
        extensions.pre_event.forEach(function(interceptor){
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
                triggerSequence: triggerSequence,
                getResponseInfo: getResponseInfo,
                logMessage: logMessage
            });
            if(typeof(result) !== "boolean" || !result){
                cont = result;
                return;
            }
        });
        if(typeof(cont) !== "boolean" || !cont){
            if(typeof(cont) === "boolean"){
                logMessage("Skipped by extension.preEvent");
                continue;
            }else{
                logMessage("Stopped by extension.preEvent");
                return;
            }
        }

        var sequenceId = null;
        if("sequence_map" in knowledge){
            for(var captureName in knowledge.sequence_map){
                if(captureName in captures){
                    var mappings = knowledge.sequence_map[captureName];
                    mappings.forEach(function(mapping){
                        if(
                            "value" in mapping && "map" in mapping &&
                            mapping.value === captures[captureName]
                        ){
                            captures[captureName] = mapping.map;
                            return;
                        }
                    });
                }
            }
        }
        if(!sequenceId && "associate_sequence" in captures){
            sequenceId = captures.associate_sequence;
        }
        if(!sequenceId && "associate_sequence" in knowledge){
            sequenceId = knowledge.associate_sequence;
        }

        // Pattern that does not involve sequence (such as FAQs)
        if(!sequenceId){
            if("responses" in knowledge){
                bot.reply(
                    message, buildSentence(
                        knowledge.responses,
                        getResponseInfo({
                            bot: bot,
                            message: message,
                            knowledgeType: knowledgeType,
                            captures: captures,
                            // Helper data
                            config: configData,
                        }).extends(
                            (
                                "dictionary" in knowledge
                            ) ? knowledge.dictionary : {}
                        )
                    )
                );
            }else{
                logMessage("No response for: " + message.text);
            }
            return;
        }
        if(
            !("sequence" in configData) ||
            !(sequenceId in configData.sequence)
        ){
            var errorData = {
                bot: bot,
                message: message,
                sequenceId: sequenceId,
                knowledgeType: knowledgeType,
                captures: captures,
                error: "seq_not_found",
                // Helper data
                config: configData,
                // Helper functions
                buildSentence: buildSentence,
                responseForError: responseForError,
                triggerSequence: triggerSequence,
                getResponseInfo: getResponseInfo,
                logMessage: logMessage
            };
            var response = responseForError("seq_not_found", errorData);

            cont = true;
            extensions.on_failed.forEach(function(interceptor){
                var result = interceptor(errorData);
                if(typeof(result) !== "boolean" || !result){
                    cont = result;
                    return;
                }
            });
            if(typeof(cont) !== "boolean" || !cont){
                if(typeof(cont) === "boolean"){
                    logMessage("Skipped by extension.onFailed");
                    continue;
                }else{
                    logMessage("Stopped by extension.onFailed");
                    return;
                }
            }

            if(response){
                bot.reply(message, response);
            }
            return;
        }
        var supported = false;
        if("supported_sequences" in knowledge){
            var supportedSequences = knowledge.supported_sequences;
            supportedSequences.forEach(function(seq){
                if(seq === sequenceId){
                    supported = true;
                    return;
                }
            });
        }else{
            supported = true;
        }
        // Sequence not supported
        if(!supported){
            logMessage("Sequence not supported: " + sequenceId);
            continue;
        }

        // Message .event

        var sequence = configData.sequence[sequenceId];

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
            triggerSequence: triggerSequence,
            getResponseInfo: getResponseInfo,
            logMessage: logMessage
        };

        cont = true;
        extensions.on_event.forEach(function(interceptor){
            var result = interceptor(eventData);
            if(typeof(result) !== "boolean" || !result){
                cont = result;
                return;
            }
        });
        if(typeof(cont) !== "boolean" || !cont){
            if(typeof(cont) === "boolean"){
                logMessage("Skipped by extension.onEvent");
                continue;
            }else{
                logMessage("Stopped by extension.onEvent");
                return;
            }
        }

        var requiredAnswer;
        if(typeof(sequence) === "function"){
            requiredAnswer = sequence(eventData);
        }else{
            requiredAnswer = triggerSequence(eventData);
        }
        if("answers" in pattern && requiredAnswer){
            bot.reply(message, buildSentence(
                pattern["answers"],
                getResponseInfo(eventData).extends(
                    ("dictionary" in knowledge) ? knowledge["dictionary"] : {}
                )
            ));
        }

        cont = true;
        extensions.post_event.forEach(function(interceptor){
            var result = interceptor(eventData);
            if(typeof(result) !== "boolean" || !result){
                cont = result;
                return;
            }
        });
        if(typeof(cont) !== "boolean" || !cont){
            if(typeof(cont) === "boolean"){
                logMessage("Continue by extension.postEvent");
                continue;
            }else{
                logMessage("Stopped by extension.postEvent");
                return;
            }
        }

        return;
    }

    if(!("unhandle_messages" in storageData)){
        storageData.unhandle_messages = [];
    }
    logMessage("[DEBUG] Unhandle message received");
    storageData.unhandle_messages.push(message);
    dataChanged = true;
}

function startBot(){
    reloadSequence([]);
    firstLaunch = false;

    if((
        !("config" in configData) ||
        !("bot_token" in configData.config) ||
        !("storage_file" in configData.config)
    )){
        logMessage(
            "Configuration file is incomplete " +
            "(\"config\", \"bot_token\" and \"storage_file\" are required)"
        );
        process.exit();
    }

    if(bot){
        bot.closeRTM();
    }
    var controller = Botkit.slackbot();
    bot = controller.spawn({
        token: configData.config.bot_token
    });

    bot.startRTM(function(err,bot,payload) {
        if (err) {
            throw new Error("Could not connect to Slack");
        }
    });

    loadStorageData();
    
    controller.hears(
        ["."],
        "direct_message,direct_mention,mention",
        interceptMessage
    );
}

function networkPing(){
    isOnline(function(err, online){
        if(online){
            if(!running){
                running = true;
                if(!firstLaunch){
                    logMessage("Restarting bot...");
                }
                startBot();
            }
        }else{
            running = false;
            logMessage(
                "Looks like the network connection is lost. " +
                "Going to restart the bot on the next try."
            );
        }
    });
}

setInterval(networkPing, 300000);
networkPing();
