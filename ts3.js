var net = require('net');
var binary = require('binary');
var events = require('events');
var util = require('util');
var logger = require('./logger.js');
var client = new net.Socket();

var ftc_obj = { "\\": "\\\\", "\/": "\\/", "\|": "\\p", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v/": "\\v", "\f/": "\\f", " ": "\\s" };
var ttc_obj = { "\\s": " ", "\\p": "|", "\\n": "\n", "\\f": "\f", "\\r": "\r", "\\t": "\t", "\\v": "\v", "\\\/": "\/", "\\\\": "\\" };

function ServerQuery(host, port) {
	events.EventEmitter.call(this);

	var ready = false;
	var commandQueue = [];
	var self = this;

	client.connect(port, host);

	client.on('connect', function() {
		var data = binary().scan('line', new Buffer('\n')).loop(function (end,vars) {
			var line = vars.line.toString();
			line = line.trim();

			if(ready) {
				onLine(line);
			}

			if (line.indexOf("Welcome") == 0) {
				ready = true;
				self.emit('ready');
			}

			this.scan('line', new Buffer('\n'))
		});
		client.pipe(data);
	});

	client.on('close', function(data) {
		self.emit('close', data);
		logger.log('info', 'CONNECTION CLOSED:' + data);
	});

	client.on('error', function(error) {
		self.emit('error', error);
		logger.log('error', 'CONNECTION CLOSED 2:' + error);
	});

	this.execute = function(command, cb) {
		commandQueue.push({command: command, cb: cb, sent: false});
	}

	function onLine(line) {
		if (line.indexOf("err") == 0) {
			commandQueue[0].err = parseTs3(line);
			var element = commandQueue.shift();
			if (typeof element.cb == "function")
				element.cb(element);
			return;
		}
		if (line.indexOf("notify") == 0) {
			var partPos = line.indexOf(' ');
			var body = parseTs3(line.substring(partPos + 1));
			var type = line.substring(0, partPos);
			self.emit('notify', {type: type, body: body});
			return;
		}
		commandQueue[0].response = parseTs3(line);
	}

	setInterval(function() {
		if (commandQueue.length == 0) {
			return;
		}
		if (commandQueue[0].sent == false) {
			commandQueue[0].sent = true;
			client.write(commandQueue[0].command.trim() + "\n", "utf8");
		}
	}, 10);

	function parseTs3(body) {
		var nBody = [];
		var items = body.split('|');
		for (var i in items) {
			var elements = items[i].split(' ');
			nBody[i] = {};
			for (var i2 in elements) {
				var element = elements[i2].split('=');
				if (typeof element[1] != "undefined") {
					element[1] = element[1].replace(/\\s|\\p|\\n|\\f|\\r|\\t|\\v|\\\/|\\\\/g, function(str) {
						return ttc_obj[str];
					});
				}
				nBody[i][element[0]] = element[1];
			}
		}
		return nBody;
	}
}

function escapeString(string) {
	string = string.replace(/\\|\/|\||\n|\r|\t|\v|\f| /g, function(str) {
		return ftc_obj[str];
	});
	return string;
}

util.inherits(ServerQuery, events.EventEmitter);

exports.ServerQuery = ServerQuery;
exports.escapeString = escapeString;