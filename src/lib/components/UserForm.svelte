<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		LOCATIONS,
		PERIODS,
		USER_CATEGORIES,
		USER_ROLES,
		WEEKDAYS,
		slotKey,
		type StandardSlots
	} from '$lib/constants';

	type Values = {
		name?: string;
		initials?: string;
		role?: string;
		category?: string;
		standardSlots?: StandardSlots;
		canWorkRatho?: boolean;
		dutyExemptAm?: boolean;
		dutyExemptPm?: boolean;
		leaveEntitlement?: number;
		displayOrder?: number;
		onRota?: boolean;
		active?: boolean;
	};

	let {
		values = {},
		errorMessage = undefined,
		isNew = false,
		submitLabel,
		action = ''
	}: {
		values?: Values;
		errorMessage?: string;
		isNew?: boolean;
		submitLabel: string;
		action?: string;
	} = $props();
</script>

<form method="POST" {action} use:enhance class="nb-card flex max-w-2xl flex-col gap-5">
	{#if errorMessage}
		<p role="alert" class="border-2 border-ink bg-coral px-3 py-2 font-bold">{errorMessage}</p>
	{/if}

	<div class="grid gap-5 sm:grid-cols-2">
		<div>
			<label for="name" class="nb-label">Full name</label>
			<input id="name" name="name" required value={values.name ?? ''} class="nb-input" />
		</div>
		<div>
			<label for="initials" class="nb-label">Initials</label>
			<input
				id="initials"
				name="initials"
				required
				maxlength="8"
				autocapitalize="characters"
				value={values.initials ?? ''}
				class="nb-input uppercase"
				aria-describedby="initials-hint"
			/>
			<p id="initials-hint" class="mt-1 text-sm">
				Shown on the rota, and used as their login username. Must be unique.
			</p>
		</div>
	</div>

	<!-- Selects set `value` on the <select>, not `selected` per <option>: after a
	     failed save, SvelteKit re-renders with form=null before re-applying the
	     result, and per-option `selected` only updates the attribute — which the
	     browser ignores on options the user has touched, wiping their choice. -->
	<div class="grid gap-5 sm:grid-cols-2">
		<div>
			<label for="category" class="nb-label">Category</label>
			<select id="category" name="category" value={values.category ?? 'doctor'} class="nb-input">
				{#each USER_CATEGORIES as category (category.value)}
					<option value={category.value}>{category.label}</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="role" class="nb-label">User type</label>
			<select id="role" name="role" value={values.role ?? 'viewer'} class="nb-input">
				{#each USER_ROLES as role (role.value)}
					<option value={role.value}>{role.label}</option>
				{/each}
			</select>
		</div>
	</div>

	<fieldset class="border-2 border-ink p-4 shadow-brutal-sm">
		<legend class="px-2 text-sm font-bold uppercase">Standard sessions</legend>
		<p class="mb-3 text-sm">
			For each half-day session, pick the practice this person normally works at (or “—” if
			they don't). “Use default values” on an empty week fills the rota from this; any session
			can still be set manually.
		</p>
		<table class="border-collapse">
			<thead>
				<tr>
					<th scope="col" class="pr-4 pb-1 text-left text-sm uppercase">Day</th>
					{#each PERIODS as period (period.value)}
						<th scope="col" class="px-3 pb-1 text-sm uppercase">
							{period.label}
							<span class="block text-xs font-normal normal-case">{period.times}</span>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each WEEKDAYS as day (day.value)}
					<tr>
						<th scope="row" class="py-1 pr-4 text-left font-bold">{day.label}</th>
						{#each PERIODS as period (period.value)}
							{@const slot = slotKey(day.value, period.value)}
							<td class="px-3 py-1 text-center">
								<select
									name={`slot:${slot}`}
									value={values.standardSlots?.[slot] ?? 'none'}
									aria-label={`${day.label} ${period.label} practice`}
									class="border-2 border-ink bg-white px-2 py-1"
								>
									<option value="none">—</option>
									{#each LOCATIONS as location (location.value)}
										<option value={location.value}>{location.label}</option>
									{/each}
								</select>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
		<label class="mt-4 flex items-center gap-2 font-bold">
			<input
				type="checkbox"
				name="canWorkRatho"
				checked={values.canWorkRatho ?? false}
				class="size-5 accent-ink"
			/>
			Can be sent to Ratho if cover is required (used by Auto-fix)
		</label>
		<div class="mt-4">
			<span class="nb-label">Excluded from duty</span>
			<div class="flex flex-wrap gap-6">
				<label class="flex items-center gap-2 font-bold">
					<input
						type="checkbox"
						name="dutyExemptAm"
						checked={values.dutyExemptAm ?? false}
						class="size-5 accent-ink"
					/>
					AM sessions
				</label>
				<label class="flex items-center gap-2 font-bold">
					<input
						type="checkbox"
						name="dutyExemptPm"
						checked={values.dutyExemptPm ?? false}
						class="size-5 accent-ink"
					/>
					PM sessions
				</label>
			</div>
			<p class="mt-1 text-sm">
				Covers duty doctor and the East Calder duty team. Auto-fix will never assign either
				in an excluded session, and validation flags it if set by hand.
			</p>
		</div>
	</fieldset>

	<div>
		<label for="leaveEntitlement" class="nb-label">Annual leave entitlement</label>
		<input
			id="leaveEntitlement"
			name="leaveEntitlement"
			type="number"
			min="0"
			max="999"
			step="1"
			value={values.leaveEntitlement ?? 0}
			class="nb-input max-w-40"
			aria-describedby="leaveEntitlement-hint"
		/>
		<p id="leaveEntitlement-hint" class="mt-1 text-sm">
			Sessions per leave year (1 April – 31 March). Half a day = 1 session, so e.g. 28 days =
			56 sessions.
		</p>
	</div>

	<div class="grid gap-5 sm:grid-cols-2">
		<div>
			<label for="displayOrder" class="nb-label">Rota order</label>
			<input
				id="displayOrder"
				name="displayOrder"
				type="number"
				step="1"
				value={values.displayOrder ?? 0}
				class="nb-input"
				aria-describedby="displayOrder-hint"
			/>
			<p id="displayOrder-hint" class="mt-1 text-sm">
				Lower numbers appear further left on the rota and spreadsheet.
			</p>
		</div>
		<div>
			<label for="password" class="nb-label">
				{isNew ? 'Password' : 'New password'}
			</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="new-password"
				required={isNew}
				minlength="8"
				class="nb-input"
				aria-describedby="password-hint"
			/>
			<p id="password-hint" class="mt-1 text-sm">
				{isNew ? 'At least 8 characters.' : 'Leave blank to keep the current password.'}
			</p>
		</div>
	</div>

	<div class="flex flex-col gap-3">
		<label class="flex items-center gap-2 font-bold">
			<input type="checkbox" name="onRota" checked={values.onRota ?? true} class="size-5 accent-ink" />
			Shown on the rota (untick for admin-only accounts)
		</label>
		<label class="flex items-center gap-2 font-bold">
			<input type="checkbox" name="active" checked={values.active ?? true} class="size-5 accent-ink" />
			Active (able to log in; inactive users also drop off the rota)
		</label>
	</div>

	<div class="flex gap-3">
		<button class="nb-btn">{submitLabel}</button>
		<a href="/users" class="nb-btn nb-btn-secondary">Cancel</a>
	</div>
</form>
