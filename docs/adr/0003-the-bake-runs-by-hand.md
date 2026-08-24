# The bake runs by hand, locally, on purpose

The obvious path is a scheduled CI job that rebakes the tiles. We chose
not to build one: this is a small project with few users, history
changes on a timescale of months, and a standing pipeline would spend
more than it saves in CI minutes, upkeep and attention. The bake is a
documented local procedure — the four stages in `scripts/bake/`, run
from a checkout, pushed to the tiles repo — rerun when someone deems it
necessary. The pipeline's parsers are fixture-tested in the normal
suite, so code rot is caught without a schedule; only an upstream
changing its format waits for the next manual run. A cron can be added
later if a manual run ever turns up broken; until then, no job.
