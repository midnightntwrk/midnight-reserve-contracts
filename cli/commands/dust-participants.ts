import { Command } from "@effect/cli";
import { format, network, provider, useBuild } from "../options";
import { withServicesUseBuild } from "../run";
import { dustParticipantsProgram } from "../report/dust-participants";

export const dustParticipants = Command.make(
  "dust-participants",
  { network, provider, useBuild, format },
  dustParticipantsProgram,
).pipe(
  Command.withDescription(
    "Count registered dust participants from cnight_generates_dust UTxOs",
  ),
  withServicesUseBuild,
);
