/* =================== THE LINKS — EDIT THIS BLOCK =================== */
/* One place for the links on the Legacy Install post-deposit page AND its PDF.
   Both read this file, so they can never disagree. After editing: run make-pdf.sh, then redeploy.
   intakeUrl is the BUYER-ONLY intake. It must never point at /build/, which ends in a $497 offer
   the buyer already owns. bundle-intake/ is the existing buyer-only clone: no price, no checkout.
   ⚠️ If the Install and the Blueprint Bundle become separate products, clone a second intake and
   repoint this. Until then one buyer intake serves both, which is one page to maintain, not two. */
var IW_LINKS = {
  intakeUrl:         "https://dashboard.legacyperformance.co/bundle-intake/",   // buyer-only intake: no price, no checkout
  onboardingCallUrl: "https://legacyperformance.co/onboarding-call",            // GHL: Onboarding Call w/ Jayme Olson
  skoolUrl:          "https://www.skool.com/legacy-performance/about"
};
