const debug = require('debug')('urungi:server');
const mongoose = require('mongoose');
const Logs = mongoose.model('Logs');

module.exports = function (app, passport) {
    var hash = require('../util/hash');

    app.get('/', function (req, res) {
        res.cookie('XSRF-TOKEN', req.csrfToken());
        res.render('index');
    });

    app.get('/login', function (req, res, next) {
        res.cookie('XSRF-TOKEN', req.csrfToken());
        res.render('login');
    });

    app.get('/auth/google', passport.authenticate('google'));

    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/login' }),
        function (req, res) {
            res.redirect('/');
        }
    );

    app.post('/api/login', function (req, res, next) {
        var Users = mongoose.model('Users');
        var Companies = mongoose.model('Companies');

        Users.countDocuments({}, function (err, c) {
            if (err) throw err;

            if (c === 0) {
                debug('no records in the users model, this is the initial setup!');
                var theCompany = {};
                theCompany.companyID = 'COMPID';
                theCompany.createdBy = 'urungi setup';
                theCompany.nd_trash_deleted = false;
                Companies.create(theCompany, function (result) {
                });

                var adminUser = {};
                adminUser.userName = 'administrator';
                adminUser.companyID = 'COMPID';
                adminUser.roles = [];
                adminUser.roles.push('ADMIN');
                adminUser.status = 'active';
                adminUser.nd_trash_deleted = false;

                hash('urungi', function (err, salt, hash) {
                    if (err) throw err;

                    adminUser.salt = salt;
                    adminUser.hash = hash;
                    var User = mongoose.model('Users');

                    User.create(adminUser, function (err, user) {
                        if (err) throw err;
                        authenticate(passport, Users, req, res, next);
                    });
                });
            } else {
                authenticate(passport, Users, req, res, next);
            }
        });
    });
};

function authenticate (passport, Users, req, res, next) {
    passport.authenticate('local', function (err, user, info) {
        if (err) { return next(err); }

        if (!user) {
            if (global.logFailLogin) {
                Logs.saveToLog(req, { text: 'User fail login: ' + info.message, code: 102 });
            }
            res.status(401).send(info.message);
        } else {
            var loginData = {
                last_login_date: new Date(),
                last_login_ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress
            };

            if (req.body.remember_me) {
                var token = ((Math.random() * Math.pow(36, 10) << 0).toString(36)).substr(-8);
                loginData.accessToken = token;
                res.cookie('remember_me', token, { path: '/', httpOnly: true, maxAge: 604800000 }); // 7 days
            }

            // insert the company's Data into the user to avoid a 2nd server query'
            var Companies = mongoose.model('Companies');

            Companies.findOne({ companyID: user.companyID }, {}, function (err, company) {
                if (err) throw err;

                if (!company) {
                    Logs.saveToLog(req, { text: 'User fail login: ' + user.userName + ' (' + user.email + ') user company not found!', code: 102 });
                    res.status(401).send("User's company not found!");
                } else {
                    user.companyData = company;

                    Users.updateOne({
                        _id: user._id
                    }, {
                        $set: loginData
                    }, function (err) {
                        if (err) throw err;
                        req.logIn(user, function (err) {
                            if (err) { return next(err); }
                            res.json({ user: user.toObject() });

                            if (global.logSuccessLogin) {
                                Logs.saveToLog(req, { text: 'User login: ' + user.userName + ' (' + user.email + ')', code: 102 });
                            }
                        });
                    });
                }
            });
        }
    })(req, res, next);
}
