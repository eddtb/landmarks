# Tile versioning: additive stays v1, breaking is a new path

Phones read tiles from a versioned path (`/v1/`) hard-coded in the
client, and the shipped client passes through every field a tile
carries. So: adding optional fields to a tile (the Wikidata facts stage
did this, no OTA needed) keeps the path and rebakes in place; a change
that would break an older reader — a renamed or removed field, a new
grid — is published under a new path with a client release, and the old
path is never mutated under phones still reading it. Mutating in place
would be simpler and would break phones we cannot see.
