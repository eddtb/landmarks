import { contactLink, legalPage } from '@/server/legal-page';

export function GET(): Response {
  return legalPage(
    'Privacy Policy',
    `<p class="updated">Last updated 22 July 2026</p>
    <p>Venture helps you discover historic places and stories near you. This policy explains how the app handles information.</p>
    <h2>Location</h2>
    <p>With your permission, Venture uses your foreground location to find nearby stories, calculate walking distances and directions, and label the area you are exploring. Coordinates are sent to Venture's service and relevant routing or geographic data providers only to answer your request. Venture does not use background location, build a location history, sell location data, or use it for advertising.</p>
    <p>You can decline location access and search near a place instead. You can change location permission at any time in iOS Settings.</p>
    <h2>Information stored on your device</h2>
    <p>Venture stores story and route caches, your current walk, and whether you dismissed the location introduction on your device. Venture has no user accounts and does not ask for your name, email address, contacts, photos, or payment details.</p>
    <h2>Service providers and sources</h2>
    <p>Venture uses Expo hosting and public or licensed geographic and historical sources, including Wikipedia and Wikimedia Commons, Historic England, Open Plaques, Geograph, and a walking-route provider. Story source text may be sent to Google Gemini to create a telling; Venture does not intentionally include personal information in that request. Providers may process technical information such as IP addresses under their own policies when servicing a request.</p>
    <h2>Analytics and advertising</h2>
    <p>Venture does not include advertising, third-party tracking, or analytics SDKs.</p>
    <h2>Children</h2>
    <p>Venture is a general-audience history app and does not knowingly collect personal information from children.</p>
    <h2>Contact</h2>
    <p>Questions or privacy requests can be sent to ${contactLink}.</p>`
  );
}
