import { contactLink, legalPage } from '@/server/legal-page';

export function GET(): Response {
  return legalPage(
    'Support',
    `<p>Need help with Venture? Email ${contactLink} and include what happened, your iPhone model, and your iOS version. Please do not include sensitive personal information.</p>
    <h2>Location isn't working</h2>
    <p>Open iOS Settings, find Venture, choose Location, and allow access while using the app. Venture also works without location permission: choose “Not now” and search near a place.</p>
    <h2>A story or route looks wrong</h2>
    <p>Send the story title or starting area and a short description of the problem. Historical information comes from the sources credited on each story, and walking routes should always be checked against signs and current local conditions.</p>
    <h2>Attribution and corrections</h2>
    <p>Each story links to its original source. For a correction to source material, follow that link; for a problem with how Venture presents it, contact us directly.</p>
    <h2>Privacy</h2>
    <p>Read Venture's <a href="/privacy">Privacy Policy</a>.</p>`
  );
}
