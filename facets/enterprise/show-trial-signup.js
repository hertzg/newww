
var config = require('../../config');

// if they agree to the ULA, notify hubspot, create a trial and send verification link

module.exports = function trialSignup (request, reply) {
  var postToHubspot = request.server.methods.npme.sendData,
      getCustomer = request.server.methods.npme.getCustomer;

  var opts = {};

  // we can trust the email is fine because we've verified it in the show-ula handler
  var data = { email: request.payload.customer_email };

  postToHubspot(config.license.hubspot.form_npme_agreed_ula, data, function (er) {

    if (er) {
      request.logger.error('Could not hit ULA notification form on Hubspot');
      request.logger.error(er);
      reply.view('errors/internal', opts).code(500);
      return;
    }

    getCustomer(data.email, function (err, customer) {

      if (err) {
        request.logger.error('Unknown problem with customer record');
        request.logger.error(err);
        reply.view('errors/internal', opts).code(500);
        return;
      }

      if (!customer) {
        request.logger.error('Unable to locate customer error ' + data.email);
        reply.view('errors/internal', opts).code(500);
        return;
      }

      if (customer && customer.id + '' === request.payload.customer_id + '') {
        return createTrialAccount(request, reply, customer);
      }

      request.logger.error('Unable to verify customer record ', data.email);
      reply.view('errors/internal', opts).code(500);
    });
  });
};

function createTrialAccount(request, reply, customer) {

  var createTrial = request.server.methods.npme.createTrial;

  var opts = {};
  createTrial(customer, function (er, trial) {
    if (er) {
      request.logger.error('There was an error with creating a trial for ', customer.id);
      request.logger.error(er);
      reply.view('errors/internal', opts).code(500);
      return;
    }

    return sendVerificationEmail(request, reply, customer, trial);
  });
}

function sendVerificationEmail (request, reply, customer, trial) {

  var opts = {};

  var sendEmail = request.server.methods.email.send;
  var redis = request.server.app.cache._cache.connection.client;

  var user = {
    name: customer.name,
    email: customer.email,
    verification_key: trial.verification_key
  };

  sendEmail('npme-trial-verification', user, redis)
    .catch(function (er) {
      request.logger.error('Unable to send verification email to ', customer);
      request.logger.error(er);
      reply.view('errors/internal', opts).code(500);
      return;
    })
    .then(function () {
      return reply.view('enterprise/thanks', opts);
    });
}
