0) Identity
We built a slot-style mining game where people pay to spin and chase freshly minted reward units. The project lives inside the Donut ecosystem as a way to create and circulate a new store-of-value candidate, but in this codebase the prize token is an internally minted unit rather than $DONUT itself. GlazeCorp built and maintains the system; DonutDAO can plug it into its wider governance and treasury flows, but nothing here gives GlazeCorp ownership of DonutDAO.

1) The core idea
Think of a factory-sized arcade cabinet that constantly prints prize coupons into a shared bucket. Anyone can insert payment to pull the lever. Each pull has a chance to scoop out a slice of the bucket, while the bucket keeps growing over time. The cabinet automatically raises or lowers the cost of the next pull based on how recently someone played. Key concepts:
- Emissions bucket: reward units trickle into a shared pool every second and pile up until someone plays.
- Spinning: a player pays the current asking price and requests a random draw that might scoop prizes from the pool.
- Epoch price decay: the asking price starts high right after a spin and slides toward zero over a set window, encouraging someone to play before it gets free.
- Settlement jump: each paid spin sets the next starting price to roughly double what was just paid, bounded by limits so it never explodes or shrinks to nothing.
- Split fees: the payment goes to a treasury wallet (and optionally a team wallet) instead of the prize pool.
- Random odds: configurable odds decide what percentage of the pool a winner receives when the random draw is revealed.

2) Why this exists
We want a predictable way to distribute newly created value without needing order books or market makers. Typical token launches either rely on sales, which can feel extractive, or faucets, which can be botted. Here, emissions accrue automatically while play creates paid entries that feed a treasury. The sliding price discourages waiting forever, and the halving schedule tempers long-term inflation.

3) The cast of characters
- Players: pay to spin, hoping to capture part of the prize pool. They risk their payment and the randomness fee; they may win nothing.
- Treasury steward: receives most or all of each payment to fund broader protocol goals.
- Team recipient (optional): can receive a fixed slice of each payment when configured; otherwise the treasury receives everything.
- Randomness provider: supplies unpredictable numbers so outcomes cannot be self-determined. If it does not respond, winnings are delayed.
- Governor/owner: sets treasury destination, optional team destination, and the odds table. This role must be trusted not to set abusive odds.

4) The system loop
1) Time passes: reward units accumulate in the pool automatically.
2) Someone spins: they pay the current asking price plus a small randomness fee, and the epoch advances.
3) Price resets: the next asking price jumps based on what was just paid, then decays toward zero over the next hour.
4) Random reveal: when the randomness provider answers, the player may win a percentage of the pool; otherwise nothing moves.
5) Repeat: emissions keep piling up until the next spin, making later spins potentially richer.

5) Incentives and value flow
- Players pay the asking price in the quoted asset and a separate fee for randomness processing.
- The asking price is split: the treasury receives 90% by default and the optional team wallet can receive up to 10%. If no team wallet is set, the treasury receives 100%.
- The prize pool is not funded by player payments; it is funded by continuous emissions minted straight into the pool.
- Winners receive a slice of the pool sized by the odds table (for example, 1% or 5% of whatever sits in the pool when revealed).
- Losers receive nothing beyond the entertainment of playing and whatever strategic value their payment gives to the treasury.

6) The rules of the system
- Anyone can play as long as they accept the current price and submit the required randomness fee before a self-chosen deadline.
- The price always falls to zero within the epoch window; it never goes negative.
- Each paid spin pushes the next starting price higher (capped), while free or near-free spins reset it to a minimum floor.
- Odds must stay within a safe range (at least a 1% payout slice, at most 100% of the pool); empty or out-of-range odds are rejected.
- The owner can change treasury and team recipients and can replace the odds table; regular players cannot.
- Without a randomness reveal, winnings stay pending and the pool remains intact.

7) A concrete walkthrough (with numbers)
- The pool starts at 0 but begins growing at 4 reward units per second.
- After 30 minutes, about 7,200 units have accrued. The asking price has decayed to roughly half its start.
- Pat pays 0.05 of the quoted asset plus the randomness fee to spin. The 0.05 is split: 0.045 to the treasury, 0.005 to the team (or all 0.05 to the treasury if no team wallet exists).
- The system doubles the just-paid price to set the next starting price, then restarts the 1-hour decay.
- When the randomness arrives, Pat’s odds entry might say “5% of the pool.” If so, Pat gets about 360 units (5% of ~7,200) transferred from the pool to their balance. If the draw had been “1%,” Pat would receive about 72 units.
- The pool keeps accruing after Pat’s spin, so the next player may face a different price and a larger or smaller pool depending on elapsed time and past wins.

8) What this solves (and what it does not)
It provides a simple, timed way to convert emissions into player-held tokens while routing payments to a treasury. It avoids fixed-price sales, and it keeps engagement up by letting the price fall if nobody plays. This is NOT a guarantee of profit, NOT a savings account, and NOT a promise that rewards hold any particular monetary value. Emissions continue even if demand falls, so dilution risk exists.

9) Power, incentives, and trust
- Influence: the owner can reroute payment recipients and rewrite the odds table; players trust that these settings remain reasonable.
- Randomness: outcomes depend on an external randomness provider responding honestly and on time.
- Treasury alignment: because player payments fund the treasury, players implicitly trust that treasury spending aligns with the ecosystem’s goals.
- Incentive balance: the falling price tempts opportunistic entry, while the rising restart price after each spin discourages rapid-fire depletion.

10) What keeps this system honest
- Rewarded behaviors: spinning when the price and pool size feel attractive, and maintaining healthy odds that spread out wins.
- Discouraged behaviors: setting odds below the allowed minimum, trying to spin with expired deadlines, or skipping the randomness fee—all automatically rejected.
- Selfish actions: if someone waits until the price is near zero, they still restart the price floor for everyone else. If the randomness provider stalls, no one gets paid out, so everyone is incentivized to keep it running.
- Slow participation: when spins slow, emissions keep stacking, making the next spin more enticing and nudging activity back up.

11) FAQ
1. What am I buying when I spin? You are paying for a chance to claim a slice of the continuously growing reward pool.
2. Where does the prize pool come from? It is filled by newly minted reward units that accumulate over time, not by player payments.
3. Who gets my payment? The treasury receives most or all of it; an optional team wallet can receive a small cut.
4. Can I lose my payment? Yes. If the random draw misses, you receive no reward units.
5. What decides my winnings? A random draw selects a payout percentage from a preset odds table.
6. Why does the price change? After each spin, the next starting price jumps up based on what was just paid, then slides down over roughly an hour.
7. Is the first spin always free? If the price has fully decayed to zero, a spin can be free aside from the randomness fee.
8. What happens if no one spins for a long time? The price eventually reaches zero while the pool keeps growing, making a future spin more attractive.
9. Can someone rig the odds? Only the designated owner can change the odds; players rely on that role to keep them fair.
10. What if the randomness provider fails? Rewards stay pending until a valid random reveal arrives.
11. Does this use $DONUT today? In this code, the prize token is a separate unit and payments are in a wrapped base asset; direct $DONUT usage is not present here.
12. Can I withdraw my reward units? Winners hold them outright; they can burn their own units, but turning them into other assets depends on external markets or tooling not shown here.

12) Glossary
- Reward unit: the token that accumulates in the pool and is awarded to winners.
- Prize pool: the shared bucket of reward units available to be won.
- Spin: a paid attempt to win a percentage of the prize pool.
- Asking price: the current cost to spin, which decays over time and jumps after each spin.
- Epoch: the period during which the asking price decays from its starting point to zero.
- Randomness fee: a small separate payment that covers the cost of fetching a random outcome.
- Odds table: the list of possible payout percentages and their likelihoods.
- Treasury: the primary destination for spin payments.
- Team wallet: an optional recipient that can receive a fixed share of each payment.
- Emissions: the continuous creation of new reward units that feed the prize pool.
- Halving: a scheduled reduction in the emission rate that happens at fixed time intervals.
- Floor price: the minimum starting price after a free or near-free spin.
- Ceiling price: the cap that prevents the starting price from growing without bound.
- Payout percentage: the slice of the prize pool granted to a winner after randomness resolves.
- Deadline: a self-imposed expiration time; spins submitted after it are rejected.
- Wrapped base asset: the token players use to pay for spins in this deployment.
- Governor/owner: the role that can set recipients and odds.
- Randomness provider: the external service that returns unpredictable numbers for each spin.
