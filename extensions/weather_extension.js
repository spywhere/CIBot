var http = require("http");

function gather_weather_data(appid, country_code, unit, place, callback){
    place = encodeURIComponent(place);
    var unitSuffix = "°K";
    if(unit === "metric"){
        unitSuffix = "°C";
    }else if(unit === "imperial"){
        unitSuffix = "°F";
    }
    var unitParam = "";
    if(unit){
        unitParam = "&units=" + unit
    }
    http.get(
        (
            "http://api.openweathermap.org/data/2.5/weather?q=" +
            place + "," + country_code + "&appid=" + appid + unitParam
        ),
        function(response){
            response.setEncoding("utf-8");
            response.on("data", function(data){
                callback({
                    error: false,
                    data: JSON.parse(data),
                    unit, unitSuffix
                });
            })
            response.resume();
        }
    ).on("error", function(){
        callback({
            error: true
        });
    });
}

function response_weather(eventData, response){
    var bot = eventData.bot;
    var message = eventData.message;
    if(response.error){
        bot.reply(
            message,
            "Hmm, something went wrong with the weather provider."
        );
        return;
    }
    var data = response.data;
    bot.reply(
        message,
        (
            "Weather in " + data.name + " is " +
            data.main.temp.toFixed(2) + response.unitSuffix +
            " with lowest of " +
            data.main.temp_min.toFixed(2) + response.unitSuffix +
            " and highest of " +
            data.main.temp_max.toFixed(2) + response.unitSuffix
        )
    );
}

function weather(eventData){
    if(
        !("weather_appid" in eventData.config.config) ||
        !("weather_country_code" in eventData.config.config)
    ){
        bot.reply(
            message,
            "Oops! Looks like your admin didn't configure me correctly."
        );
        return;
    }
    var appid = eventData.config.config.weather_appid;
    var country_code = eventData.config.config.weather_country_code;
    var unit = null;
    if("weather_unit" in eventData.config.config){
        unit = eventData.config.config.weather_unit;
    }

    var bot = eventData.bot;
    var message = eventData.message;

    var captures = eventData.captures;
    if("place" in captures){
        var place = captures.place;
        bot.reply(message, "Got it, just wait a second...");
        console.log("gathering weather data for: " + place);
        gather_weather_data(
            appid,
            country_code,
            unit,
            place,
            function(response){
                response_weather(eventData, response);
            }
        );
    }else{
        bot.reply(
            message,
            "I don't know where you want me to look up the weather."
        );
    }
}

exports.config = {
    sequence: {
        weather: weather
    }
};
