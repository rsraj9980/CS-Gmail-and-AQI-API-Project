const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require("crypto");
const querystring = require("querystring");

// Getting credentials from the credentials.json file and placing them in their appropriate variable name for further use
const {YOUR_API_KEY, client_id, client_secret, scope, response_type,redirect_uri,grant_type} = require("./auth/credentials.json");

const port = 3000;

const user_states = [];
const server = http.createServer();

// Server listening method
server.on("listening", listen_handler);
server.listen(port); 
function listen_handler(){
    console.log(`Now Listening on Port ${port}`);
    console.log(server.address());
}

// Server request method
server.on("request", request_handler);
function request_handler(req,res){
  console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
    if(req.url === "/"){
       const form = fs.createReadStream('html/main.html');
       res.writeHead(200, {'Content-Type':'text/html'});
       form.pipe(res);
    }

    // This will work when we put city in the html form and press search
    else if (req.url.startsWith("/search")){
      let user_input = url.parse(req.url,true).query;
      if(user_input === null){
        not_found(res);
      }
      const {city} = user_input;
      const state = crypto.randomBytes(20).toString("hex");
      user_states.push({city,state});
      redirect_to_gmail(state, res);
    }

    // This method sends a access token request to the API using the code we get back from endpoint request 
    else if(req.url.startsWith("/receive_code")){
      const {code, state} = url.parse(req.url, true).query;
      console.log("THIS IS THE CODE WE ARE GETTING BACK AS A RESPOSE");
      console.log(code);
      console.log("\n\n");
      let user_state = user_states.find(user_state => user_state.state === state);
      if(code === undefined || state === undefined || user_state === undefined){
        not_found(res);
        return;
      }
      const {city} = user_state;
      send_access_token_request(code, city, res);
    }
    else{
      not_found(res);
    }
}

// This method will give us a 404 message when we get an ERROR
function not_found(res){
	res.writeHead(404, {"Content-Type": "text/html"});
	res.end(`<h1>404 Not Found</h1>`);
}

// This will make a request to the Gmail API endpoint for authorization
function redirect_to_gmail(state, res){
	const authorization_endpoint = "https://accounts.google.com/o/oauth2/v2/auth";
  console.log("CLIENT ID AND SCOPE AND STATE");
  console.log({client_id, scope, state , response_type, redirect_uri});
  console.log("\n\n");
  let uri = querystring.stringify({ response_type, client_id,redirect_uri, scope, state});
	res.writeHead(302, {Location: `${authorization_endpoint}?${uri}`})
	   .end();
}

// GETTING access token from the Gmail API
function send_access_token_request(code, city, res){
	const token_endpoint = "https://accounts.google.com/o/oauth2/token";
	const post_data = querystring.stringify({grant_type ,client_id, client_secret, code,redirect_uri});
	let options = {
		method: "POST",
		headers:{
			"Content-Type":"application/x-www-form-urlencoded"
		}
	}
	https.request(
		token_endpoint, 
		options, 
		(token_stream) => process_stream(token_stream, receive_access_token, city, res)
	).end(post_data);
}

// This method will process the Stream and add the data to the body
function process_stream (stream, callback , ...args){
  let body = "";
  stream.on("data", chunk => body += chunk);
  stream.on("end", () => callback(body, ...args));
}

// Parsing the access token to send it to the Gmail api in future
function receive_access_token(body,city, res){
	const {access_token} = JSON.parse(body);
  console.log("THIS IS THE ACCESS TOKEN");
  console.log(access_token);
  console.log("\n\n");
	send_get_emailId_request(city,access_token, res);
}

// This method wll send an API GET request to the GMAIL API 
// It will get the JSON data from the GMAIL API which contains "ID" of each message
function send_get_emailId_request(city,access_token, res){
	const task_endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages`;
  const options = {
		headers:
    {
      method: "GET",
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
      Accept: "application/json",
    },
	}

	https.request(
    task_endpoint, 
		options, 
		(task_stream) => process_stream(task_stream, receive_emailId_response,city, access_token, res)
    ).end();
  }

// This function is parsng the ID we got from the previous GET request to the GMAIL API
// It will also pass the ID of the latest message to the next function for further use 
function receive_emailId_response(body,city, access_token, res){
  const results = JSON.parse(body);
  console.log("This is the first API GET request which gives us the message ID")
  console.log(results.messages[0]);
  console.log("\n\n");
  let messageId = results.messages[0].id;
  send_get_emailinfo_request(city,access_token,messageId,res);
}

// This fucntion will get the latest Email ID from the previous method and use it to make another GET request to the GMAIL API
function send_get_emailinfo_request(city,access_token,messageId,res){
	const task_endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`;
  const options = {
		headers:
    {
      method: "GET",
      "Content-Type": "application/json",
      Authorization: `Bearer ${access_token}`,
      Accept: "application/json",
    },
	}

	https.request(
    task_endpoint, 
		options, 
		(task_stream) => process_stream(task_stream, receive_message_response,city, res)
    ).end();
  }

  // This method will give us email message data and then we parse it and pass it to the second API request
  function receive_message_response(body,city, res){
    const results = JSON.parse(body);
    console.log("This is the message we extracted from the second GET request using ID");
    console.log(results.snippet);
    console.log("\n\n")
    let emailMessage = results.snippet;
    // Second API call
    get_weather_information( city,emailMessage, res);
  }

  // THIS IS THE SECOND API CALL

  // This method will get make a request to the AirVisual API using API KEY authentication
  // This method will give us the city weather data which we will parse in  next method
  function get_weather_information( city,emailMessage, res){
    const weather_endpoint = `https://api.airvisual.com/v2/city?city=${city}&state=New York&country=USA&key=${YOUR_API_KEY}`;
    const weather_request = https.get(weather_endpoint);
    weather_request.once("response", process_stream);
    function process_stream (weather_stream){
      let weather_data = "";
      weather_stream.on("data", chunk => weather_data += chunk);
      weather_stream.on("end", () => serve_results(weather_data,emailMessage, res));
    }
  }

  // This method will parse the weather API data and also use the email api data to write it as an html document. 
  function serve_results(weather_data,emailMessage, res){
  let weather_object = JSON.parse(weather_data);
  console.log("THIS IS THE RESPONSE WE GET FROM AIRVISUAL API");
  console.log(weather_object);
  console.log("\n\n");
  if(weather_object.status === "fail"){
    res.writeHead(200, {"Content-type": "text/html"});
    res.end(`
    <html>
    <head>
        <style>
            body{

                margin: 0 auto;
                max-width: 600px;
                max-height: 400px;
                overflow-x: hidden;
            }
            .title{
              color:red;
              display:flex;
              background-color: gray;
              box-shadow: 2px 2px 2px black;
              width: 80vmin;
              height: 10vmin;
              border-radius:20px;
              font-size: 20px;
              justify-content: center;
              margin: 20px;
            }
            .message{
                display:grid;
                width: 80vmin;
                height: 20vmin;
                border-radius:20px;
                font-size: 12px;
                justify-items: center;
                margin: 20px;
            }
            button{
              width: 270px;
              height: 40px;
              border-radius:10px;
            }
        </style>
    </head>
    <body> 
      <form method="post" action="http://localhost:3000">
      <div class="title">
      <h1>404 error!</h1>
      </div>
      <div class="message">
      <h2>The city you are searching for does not belongs to New York state. PLEASE TRY AGAIN!</h2>
      <button type="submit">Go back to main page</button>
      </div>
      </form>
    </body>
    </html>
    `)
  }
  else{
  let weather_dataObj = weather_object.data;
  let weather_current = weather_dataObj.current;
  let temperature = weather_current.weather.tp;
  let airPressure = weather_current.weather.pr;
  let weather_pollution = weather_current.pollution;
  let weather_airQuality = weather_pollution.aqius;
  res.writeHead(200, {"Content-type": "text/html"});
  res.end(`
  <html>
    <head>
        <style>
            body{
                margin: 0 auto;
                max-width: 600px;
                max-height: 400px;
                overflow-x: hidden;
            }
            .title{
              display:flex;
              background-color: gray;
              box-shadow: 2px 2px 2px black;
              width: 80vmin;
              height: 10vmin;
              border-radius:20px;
              font-size: 10px;
              justify-content: center;
              margin: 20px;
            }
            .message{
                display:flex;
                background-color: cadetblue;
                box-shadow: 2px 2px 2px black;
                width: 80vmin;
                height: 30vmin;
                border-radius:20px;
                font-size: 10px;
                justify-content: center;
                margin: 20px;
            }
        </style>
    </head>
    <body>  
    <form method="post" action="http://localhost:3000">
      <div class="title">
        <h1>LATEST GMAIL MESSAGE</h1>
      </div>
      <div class="message">
        <h1>${emailMessage}</h1>
      </div>
      <div class="title">
        <h1>YOUR CITY's WEATHER</h1>
      </div>
      <div class="message">
        <h1>The air quality is ${weather_airQuality}<br>The temperature is ${temperature}<br>The air pressure is ${airPressure}</h1>
      </div>
      <br><br>
      <button type="submit">Go back to main page</button>
    </form>  
    </body>
  </html>
  `);
}
}