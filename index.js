var http = require('http');
var fs = require('fs');
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

var firebase = require("firebase/app");
require("firebase/auth");
require("firebase/firestore");

var config = require('./config.js')
var firebaseConfig = {
  apiKey: config.apiKey,
  authDomain: config.authDomain,
  databaseURL: config.databaseURL,
  projectId: config.projectId,
  storageBucket: config.storageBucket,
  messagingSenderId: config.messagingSenderId,
  appId: config.appId,
  measurementId: config.measurementId
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();

// MCU Configuration
var SerialPort = require("serialport");
var serialPort = new SerialPort(
  "COM8",
  {
    baudRate: 9600,
    parser: new SerialPort.parsers.Readline("\n"),
    flowControl: true
  },
  false
);


var getLatestAPIBasetime = function() {
  var a = new Date();
  var b = a.getTime();
  b -= b%(1000*60*60); // 분단위 이하 내림
  var c = a.getHours();
  if (c%3 == 0) {
    b-=(1000*60*60*1)
  } else if (c%3 == 1) {
    b-=(1000*60*60*2)
  } //else if (c%3 == 2) {
    //b-=(1000*60*60*0);
  //};
  return new Date(b);
};

var getLatestLOGBasetime = function() {
  var a = new Date();
  var b = a.getTime();
  b -= b%(1000*60*60); // 분단위 이하 내림
  return new Date(b);
};

//'201007031500' (YYYYMMDDHHMM) -> JavaScript Date Object 
var stringToDateObj = function(string) {
  return new Date(string.substr(0,4), string.substr(4,2)-1, string.substr(6,2), string.substr(8,2), string.substr(10,2));
};

//JavaScript Date Object -> '201007031500' (YYYYMMDDHHMM)
var dateObjToString = function(date) {
  return dateObjToString_Base_Date(date)+dateObjToString_Base_Time(date)
}

//JavaScript Date Object -> '20100703' (YYYYMMDD)
var dateObjToString_Base_Date = function(date) {
  var base_date = (date.getYear()+1900)+'';
  if (date.getMonth() < 10 ) { base_date += '0'; }
  base_date += (date.getMonth()+1);
  if ( date.getDate() < 10 ) { base_date += '0'; }
  base_date += date.getDate();
  
  return base_date
}

//JavaScript Date Object -> '1500' (HHMM)
var dateObjToString_Base_Time = function(date) {  
  var base_time = '';
  if (date.getHours() < 10) { base_time += '0'; }
  base_time += ( date.getHours()*100 );

  return base_time
}

// API → Firebase DB 넣는 로직
var addOutsideData = function(key, hum, temp) {
  db.collection("mc").doc(key).set({
  outside_hum: hum,
  outside_temp: temp,
  time: stringToDateObj(key),
  }, { merge: true })
  .then(function() {
      console.log("Outside : Document written with ID: "+key);
  })
  .catch(function(error) {
      console.error("Outside : Error adding document: ", error);
  });
};

// 기상청 API 정보 가져오는 로직
var getWeatherAPI = function(basetime){
    var base_date = dateObjToString_Base_Date(basetime);
    var base_time = dateObjToString_Base_Time(basetime);
    
    // 서울시 강남구 역삼동 좌표
    var nx = '61';
    var ny = '125';

    var xhr = new XMLHttpRequest();
    var url = 'http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService2/ForecastSpaceData'; /*URL*/
    var queryParams = '?' + encodeURIComponent('ServiceKey') + '='+'dwDMw%2B1L3YCOUCYLjDR6chdmxVQSOTs1cGh7UqfL0r1t4idPxo3cuNSNKAls3BzWyoIaULNEtgddZQXiaq4GVg%3D%3D'; /*Service Key*/
    queryParams += '&' + encodeURIComponent('base_date') + '=' + encodeURIComponent( base_date ); /*‘15년 12월 1일발표*/
    queryParams += '&' + encodeURIComponent('base_time') + '=' + encodeURIComponent( base_time ); /*05시 발표 * 기술문서 참조*/
    queryParams += '&' + encodeURIComponent('nx') + '=' + encodeURIComponent(nx); /*예보지점의 X 좌표값*/
    queryParams += '&' + encodeURIComponent('ny') + '=' + encodeURIComponent(ny); /*예보지점의 Y 좌표값*/ //역삼동
    queryParams += '&' + encodeURIComponent('numOfRows') + '=' + encodeURIComponent('300'); /*한 페이지 결과 수*/
    queryParams += '&' + encodeURIComponent('pageNo') + '=' + encodeURIComponent('1'); /*페이지 번호*/
    queryParams += '&' + encodeURIComponent('_type') + '=' + encodeURIComponent('json'); /*xml(기본값), json*/
    
    xhr.open('GET', url + queryParams);
    xhr.onreadystatechange = function () {
      if (this.readyState == 4) {
          result = eval('('+this.responseText+')');
          array = result.response.body.items.item
          var obj = new Object();
          
          for(i of array){
            var key = ''+i.fcstDate+i.fcstTime;
            if(i.category === 'REH') { var hum = i.fcstValue; };
            if(i.category === 'T3H') { var temp = i.fcstValue; };
            obj[key] = {'hum':hum, 'temp':temp}            
          };

          for(var key in obj) {
            addOutsideData(key, obj[key].hum, obj[key].temp);
          };
      }
    };
    xhr.send('');
}


// LOG → Firebase DB 넣는 로직 (현재시각)
var addInsideData = function(key, hum, temp) {
  db.collection("mc").doc(key).set({
    inside_hum: hum,
    inside_temp: temp,
    time: stringToDateObj(key),
    }, { merge: true })
    .then(function() {
        console.log("Inside : Document written with ID: ", key);
    })
    .catch(function(error) {
        console.error("Inside : Error adding document: ", error);
    });
};


var APIBasetime = getLatestAPIBasetime();
getWeatherAPI( APIBasetime );  

// API Interval
setInterval(function(){
  if( new Date().getHours()%3 == 0 ) { // Interval 가 30min이므로 매 3시간당 2번씩 실행됨
    var APIBasetime = getLatestAPIBasetime();
    getWeatherAPI( APIBasetime );      
  }
},1000*60*30)


//MUC -> NodeJS : Data 받는 로직 안에 실행 // MCU에서 10분마다 정보 전송
serialPort.open(function() {
  console.log("Device connected...");
  var buff = "";
  serialPort.on("data", function(data) {
    console.log("Data : " + data);
    
    buff += data;
    if (buff.indexOf("\n") !== -1) {
          //data를 buff에 담아서 처리, hum, temp 변수에 값 삽입
          if(buff.charAt(2)=== 't') {
            console.log("buff temp")
            temp = buff.substring(0,2);
          } else if (buff.charAt(2)=== 'h') {
            console.log("buff hum")
            hum = buff.substring(0,2);
          } else {
            console.log("error : buff empty")
          }

      console.log("buff : " + buff);
      buff = ""; //clear the Buffer
    }
    
    // MCU -> Server 전송 주기가 10min이므로 매 시간당 2번씩 실행됨
    if( new Date().getMinutes() < 20 ) { 
      if(hum != undefined && temp != undefined) {
        console.log("inside add")
        var LOGBasetime = getLatestLOGBasetime();
        var key = dateObjToString(LOGBasetime);
        addInsideData(key, parseInt(hum), parseInt(temp));
        addInsideData2(key, parseInt(hum), parseInt(temp));
        temp = undefined;
        hum = undefined;
      }
    }
  });
});


// NodeJS Server Configuration
var app = http.createServer(function(request,response){
  var url = request.url;
  if(request.url == '/'){
    url = '/index.html';
  }
  if(request.url == '/favicon.ico'){
      response.writeHead(404);
      response.end();
      return;
  }
  response.writeHead(200);
  response.end(fs.readFileSync(__dirname + url));
});
app.listen(3000);