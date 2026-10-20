/* =================== THE LINKS — EDIT THIS BLOCK =================== */
/* One place for the links on the Legacy Install post-purchase page AND its PDF.
   Both read this file, so they can never disagree. After editing: run make-pdf.sh, then redeploy.
   intakeUrl is the BUYER-ONLY intake. It must never point at /build/, which ends in a $497 offer
   the buyer already owns. install-intake/ is the buyer-only intake: no price, no checkout.
   bundle-intake/ is left in place so any old link still resolves; install-intake/ is the live one. */
var IW_LINKS = {
  intakeUrl:         "https://dashboard.legacyperformance.co/install-intake/",   // buyer-only intake: no price, no checkout. Opens their Roster row.
  appUrl:            "https://dashboard.legacyperformance.co/client.html",       // the Legacy App. Identity gate = name + DOB + email vs their Roster row
  onboardingCallUrl: "https://legacyperformance.co/onboarding-call",            // GHL: Onboarding Call w/ Jayme Olson
  skoolUrl:          "https://www.skool.com/legacy-performance/about",
  weeklyCallUrl:     "https://us06web.zoom.us/j/88036598243?pwd=cnj4tJJJ4eDfGMzR7bhjeg4IEcoVEJ.1"  // Built 4 More Call — weekly Mon group call, first one Nov 2 2026 (Google Cal event, Zoom ID 880 3659 8243 / passcode 564934)
};
