const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const socialLogin = require('./socialLogin');

const getProfileDetails = ({ profile }) => ({
  email: profile.emails[0].value,
  id: profile.id,
  avatarUrl: profile.photos[0].value,
  username: profile.name.givenName,
  name: `${profile.name.givenName}${profile.name.familyName ? ` ${profile.name.familyName}` : ''}`,
  emailVerified: profile.emails[0].verified,
});

/*
 * AI Scholar Hub institutional security policy:
 *
 * Google authenticates identity; AIH authorizes access.
 * Normal Google OAuth must never auto-provision an AIH account.
 * Institution users must first be singly or bulk provisioned in AIH.
 */
const googleLogin = socialLogin('google', getProfileDetails, {
  existingUsersOnly: true,
  allowPreprovisionedLink: true,
  enforceInstitutionSsoPolicy: true,
});

const googleAdminLogin = socialLogin('google', getProfileDetails, {
  existingUsersOnly: true,
});

const getGoogleConfig = (callbackURL) => ({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL,
  proxy: true,
});

const googleStrategy = () =>
  new GoogleStrategy(
    getGoogleConfig(`${process.env.DOMAIN_SERVER}${process.env.GOOGLE_CALLBACK_URL}`),
    googleLogin,
  );

const googleAdminStrategy = () =>
  new GoogleStrategy(
    getGoogleConfig(`${process.env.DOMAIN_SERVER}/api/admin/oauth/google/callback`),
    googleAdminLogin,
  );

module.exports = googleStrategy;
module.exports.googleAdminLogin = googleAdminStrategy;
