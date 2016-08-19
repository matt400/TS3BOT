var TS3 = require('./ts3.js');
var logger = require('./logger.js');
var CronJob = require('cron').CronJob;
var sql = require('sqlite3').verbose();
var async = require('async');
var config = require('./config.json');

var client = new TS3.ServerQuery('localhost', 10011);
var db = new sql.Database('./bot.db');

var bad_words = new RegExp(config.BAD_WORDS.join("|"), 'gi');

var bot_id, ladv = 0;

var away_users = {};
var idle_users = {};
var as = {};

client.on('ready', function() {
	client.execute('login ' + config.SERVER_LOGIN + ' ' + config.SERVER_PASSWORD);
	client.execute('use ' + config.SERVER_ID);
	client.execute('clientupdate client_nickname=' + TS3.escapeString(config.BOT_NAME));
	client.execute('whoami', function(data) {
		bot_id = data.response[0].client_id;
	});
	client.execute('servernotifyregister event=server');
	client.execute('servernotifyregister event=textserver');
	client.execute('servernotifyregister event=textprivate');
});

client.on('notify', function(notification) {
	if(notification.type == "notifycliententerview") {
		// AUTOMATIC USER REGISTRATION
		if(notification.body[0].client_unique_identifier !== "ServerQuery") {
			async.waterfall([
				function(callback) {
					db.get("SELECT user_uqid FROM users WHERE user_uqid = ?", [notification.body[0].client_unique_identifier], callback);
				}
			], function(err, result) {
				if(result === undefined) {
					var ins = db.prepare("INSERT INTO users(user_id, user_uqid, user_last_connected, user_connected_time, registered) VALUES (null, ?, ?, ?, ?)");
					ins.run(notification.body[0].client_unique_identifier, Date.now(), 0, 0);
				}
			});
			client.execute('sendtextmessage targetmode=1 target=' + notification.body[0].clid + ' msg=' + TS3.escapeString(config.WELCOME_MESSAGE));
		}
	} else if(notification.type == "notifytextmessage") {
		if(notification.body[0].invokerid !== bot_id) {
			if(notification.body[0].targetmode == "1") {
				// USER EXCLUSION FROM IDLE
				if(notification.body[0].msg == "!idle_stop") {
					async.waterfall([
						function(callback) {
							db.get("SELECT user_uqid, time FROM users_idle_ignore WHERE user_uqid = ?", [notification.body[0].invokeruid], callback);
						}
					], function (err, result) {
						if(result === undefined) {
							var ins = db.prepare("INSERT INTO users_idle_ignore(user_id, user_uqid, time) VALUES (null, ?, ?)");
							ins.run(notification.body[0].invokeruid, Date.now());
							client.execute('sendtextmessage targetmode=1 target=' + notification.body[0].invokerid + ' msg=' + TS3.escapeString('Nie będziesz już automatycznie przerzucany.'));
						} else {
							client.execute('sendtextmessage targetmode=1 target=' + notification.body[0].invokerid + ' msg=' + TS3.escapeString('Jesteś już dodany do listy ignorowanych.'));
						}
					});
				} else if(notification.body[0].msg == "!idle_start") {
					async.waterfall([
						function(callback) {
							db.get("SELECT user_uqid, time FROM users_idle_ignore WHERE user_uqid = ?", [notification.body[0].invokeruid], callback);
						}
					], function(err, result) {
						if(result === undefined) {
							client.execute('sendtextmessage targetmode=1 target=' + notification.body[0].invokerid + ' msg=' + TS3.escapeString('Zostałeś już usunięty z listy ignorowanych.'));
						} else {
							db.run("DELETE FROM users_idle_ignore WHERE user_uqid = $user_uqid", { $user_uqid: notification.body[0].invokeruid });
							client.execute('sendtextmessage targetmode=1 target=' + notification.body[0].invokerid + ' msg=' + TS3.escapeString('Będziesz automatycznie przerzucany.'));
						}
					});
				}
				if(as.hasOwnProperty(notification.body[0].invokerid)) {
					var as_date = Date.now() - as[notification.body[0].invokerid].date;
					as[notification.body[0].invokerid].times++;
					if(as[notification.body[0].invokerid].times > 3 && as_date < 15000) {
						client.execute('clientkick clid=' + notification.body[0].invokerid + ' reasonid=5 reasonmsg=' + TS3.escapeString('Nie spamuj!'));
					}
					if(as_date > 15000) {
						delete as[notification.body[0].invokerid];
					}
				} else {
					as[notification.body[0].invokerid] = { times: 1, date: Date.now() };
				}
			} else if(notification.body[0].targetmode == "3") {
				if(notification.body[0].msg == "!bot") {
					client.execute('sendtextmessage targetmode=1 target=' + notification.body[0].invokerid + ' msg=Tak?');
				}
			}
		}
	}
});

if(config.ENABLE_ADVERTS) {
	new CronJob(config.ADVERTS_SHOW_TIME, function() {
		var adverts = config.ADVERTS.length - 1;
		client.execute('sendtextmessage targetmode=3 target=' + config.SERVER_ID + ' msg=' + TS3.escapeString(config.ADVERTS[ladv]));
		if(ladv == adverts) {
			ladv = 0;
		} else {
			ladv++;
		}
	}, null, true, 'Europe/Warsaw');
}

(function clientlist() {
	client.execute('clientlist -uid -away -times -groups -info', function(data) {
		var cl = data.response;
		async.forEachOf(cl, function(value, key, callback) {
			if(value.client_unique_identifier !== 'serveradmin' && value.client_version !== 'ServerQuery') {
				// AWAY & IDLE
				if(value.client_away !== '1') {
					if(away_users.hasOwnProperty(value.clid)) {
						client.execute('clientmove clid=' + value.clid + ' cid=' + away_users[value.clid].channel_id);
						delete away_users[value.clid];
					}
				} else if(value.client_away !== '0') {
					if(!away_users.hasOwnProperty(value.clid)) {
						client.execute('clientmove clid=' + value.clid + ' cid=' + config.AWAY_CHANNEL_ID);
						away_users[value.clid] = { channel_id: value.cid, time: Date.now() };
					}
				}

				async.waterfall([
					function(callback) {
						var group_exist = false;
						var user_groups = value.client_servergroups.split(',').map(Number);
						for(var ig in config.IDLE_GROUPS_IGNORE) {
							var number = config.IDLE_GROUPS_IGNORE[ig];
							if(user_groups.indexOf(number) > -1) {
								group_exist = true;
								break;
							}
						}
						callback(null, group_exist);
					}
				], function (err, group_exist) {
					if(!group_exist) {
						if(parseInt(value.cid) !== config.AWAY_CHANNEL_ID) {
							var idle_time = parseInt(value.client_idle_time) / 1000;
							if(idle_time >= config.MAX_IDLE_TIME) {
								async.waterfall([
									function(callback) {
										db.get("SELECT user_uqid, time FROM users_idle_ignore WHERE user_uqid = ?", [value.client_unique_identifier], callback);
									}
								], function(err, result) {
									if(result === undefined) {
										if(!idle_users.hasOwnProperty(value.clid)) {
											idle_users[value.clid] = { seconds: 1, warned: 0, moved: 0 };
										} else {
											if(idle_users[value.clid].seconds <= config.MAX_IDLE_WARNING) {
												if(!idle_users[value.clid].warned) {
													idle_users[value.clid].warned = 1;
													client.execute('sendtextmessage targetmode=1 target=' + value.clid + ' msg=' + TS3.escapeString('Za ' + config.MAX_IDLE_WARNING + ' sekund zostaniesz przerzucony na kanał AFK, jeśli nie wykonasz żadnej czynności. Możesz użyć komendy [b]!idle_stop[/b], aby wyłączyć automatyczne przerzucanie. Aby włączyć użyj komendy [b]!idle_start[/b]. Spamowanie komendami grozi automatycznym kickiem! Jeśli występują problemy z botem napisz do Yii.'));
												} else if(idle_users[value.clid].warned && idle_users[value.clid].seconds >= config.MAX_IDLE_WARNING) {
													client.execute('clientmove clid=' + value.clid + ' cid=' + config.AWAY_CHANNEL_ID);
													idle_users[value.clid].moved = 1;
												}
												idle_users[value.clid].seconds++;
											}
										}
									}
								});
							} else {
								if(idle_users.hasOwnProperty(value.clid)) {
									delete idle_users[value.clid];
								}
							}
						}
					}
				});

				// BAD NAME CHECKER
				if(config.ENABLE_NAME_CHECKER) {
					if(value.client_nickname.match(bad_words)) {
						client.execute('clientkick clid=' + value.clid + ' reasonid=5 reasonmsg=' + TS3.escapeString('Twój nick zawiera przekleństwa!'));
					}
				}

				// AUTOMATIC USER REGISTRATION
				async.waterfall([
					function(callback) {
						db.get("SELECT user_last_connected, user_connected_time, registered FROM users WHERE user_uqid = ?", [value.client_unique_identifier], callback);
					}
				], function(err, result) {
					if(result) {
						if(!result.registered) {
							var connected_time = result.user_connected_time + 1;
							db.run("UPDATE users SET user_last_connected = $user_last_connected, user_connected_time = $user_connected_time WHERE user_uqid = $user_uqid", {
								$user_last_connected: parseInt(value.client_lastconnected),
								$user_connected_time: connected_time,
								$user_uqid: value.client_unique_identifier
							});
							if(result.user_connected_time >= config.USER_REGISTER_SECONDS) {
								db.run("UPDATE users SET registered = $registered WHERE user_uqid = $user_uqid", {
									$registered: 1,
									$user_uqid: value.client_unique_identifier
								});
								client.execute('servergroupaddclient sgid=' + config.REGISTER_GROUP_ID + ' cldbid=' + value.client_database_id);
								client.execute('sendtextmessage targetmode=1 target=' + value.clid + ' msg=' + TS3.escapeString('[b][color=red]ZOSTAŁEŚ ZAREJESTROWANY PO ' + config.USER_REGISTER_SECONDS + ' SEKUNDACH POBYTU NA SERWERZE![/color][/b]'));
							}
						}
					}
				});
			}
		}, function (err) {
			if (err) {
				logger.log('error', 'ASYNC ERROR:' + err.message);
			}
		});
	});
	setTimeout(clientlist, 1000);
})();

(function channel() {
	client.execute('channellist -topic -flags -voice -limits -icon', function(data) {
		var cl = data.response || false;
		if(cl) {
			for(var json in cl) {
				var channel = cl[json];
				// BAD NAME CHANNEL CHECKER
				if(config.ENABLE_CHANNEL_CHECKER) {
					if(channel.channel_name.match(bad_words)) {
						var bad_name = channel.channel_name.split(bad_words).join("");
						client.execute('channeledit cid=' + channel.cid + ' channel_name=' + TS3.escapeString(bad_name));
					}
				}
			}
		}
	});
	setTimeout(channel, 5000);
})();

client.on('error', function(error) {
	logger.log('error', 'Error:' + error);
	db.close();
});

client.on('close', function(close) {
	logger.log('error', 'Connection has been closed:' + close);
	db.close();
});