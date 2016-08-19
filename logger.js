var winston = require("winston");

var logger = new (winston.Logger)({
	transports: [
		new (winston.transports.File)({
			name: 'info-file',
			filename: 'bot-info.log',
			level: 'info'
		}),
		new (winston.transports.File)({
			name: 'error-file',
			filename: 'bot-error.log',
			level: 'error'
		})
	]
});

module.exports = logger;