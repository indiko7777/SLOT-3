# Stake review notes: earned gold-star modes

Prepared for review; not sent or approved.

## Exact mechanic

Rare WILDs in a paid round reveal individual pieces of a character silhouette. A piece itself grants no additional reward. Completing a silhouette grants one saved gold star, up to three. On the next eligible paid base spin, the frontend selects the separately published base_tier1, base_tier2 or base_tier3 mode. Each costs 1x base bet and has independently verified 96% RTP. The selected book determines the entire round; a star earned during animation cannot change that round. Ante and purchased bonus modes do not use the saved head-start. Natural Getaway entry consumes saved stars. Completing all characters resets the visual collection for prestige without deleting the third-star reward. Cosmetic frame themes persist independently.

## Question requiring a ruling

Do Stake's independent-bet/stateless requirements permit outcome-earned eligibility for these separately published modes, when each new round is sampled independently within its selected mode and each mode has the same RTP?

The concern is eligibility depending on earlier outcomes, not random sampling within a book. For example, two players choosing the same base stake can enter different modes because one completed a character on earlier paid spins. Equal RTP does not mean the modes have identical outcome distributions or establish that this eligibility rule is accepted.

## Available implementation paths

1. Preserve the exact requested design if Stake accepts earned eligibility for separately approved modes. Current implementation follows this path pending assessment.
2. Make all approved star modes freely selectable. Collection still reveals silhouettes and awards gold-star achievements, but earlier outcomes no longer gate mode access. This changes the requested reward's gameplay meaning and needs a design decision.
3. Earn and use the gameplay star inside one paid round or its included bonus, with the full continuation already represented in that round's math book. Only the visual achievement persists across bets. This requires a math redesign and republishing, not a label change.

Simply renaming a persistent reward a bonus does not settle the rule. Conversely, the public rule alone does not establish that Stake has rejected this exact multi-mode design.
