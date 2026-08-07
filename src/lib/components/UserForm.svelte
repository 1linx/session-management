<script lang="ts">
	import { enhance } from '$app/forms';
	import { ALL_SLOTS, PERIODS, USER_CATEGORIES, USER_ROLES, WEEKDAYS, slotKey } from '$lib/constants';

	type Values = {
		name?: string;
		initials?: string;
		email?: string;
		role?: string;
		category?: string;
		workingSlots?: string[];
		displayOrder?: number;
		onRota?: boolean;
		active?: boolean;
	};

	let {
		values = {},
		errorMessage = undefined,
		isNew = false,
		submitLabel
	}: {
		values?: Values;
		errorMessage?: string;
		isNew?: boolean;
		submitLabel: string;
	} = $props();
</script>

<form method="POST" use:enhance class="nb-card flex max-w-2xl flex-col gap-5">
	{#if errorMessage}
		<p role="alert" class="border-2 border-ink bg-coral px-3 py-2 font-bold">{errorMessage}</p>
	{/if}

	<div class="grid gap-5 sm:grid-cols-2">
		<div>
			<label for="name" class="nb-label">Full name</label>
			<input id="name" name="name" required value={values.name ?? ''} class="nb-input" />
		</div>
		<div>
			<label for="initials" class="nb-label">Initials (shown on rota)</label>
			<input
				id="initials"
				name="initials"
				required
				maxlength="8"
				value={values.initials ?? ''}
				class="nb-input"
			/>
		</div>
	</div>

	<div>
		<label for="email" class="nb-label">Email address</label>
		<input id="email" name="email" type="email" required value={values.email ?? ''} class="nb-input" />
	</div>

	<div class="grid gap-5 sm:grid-cols-2">
		<div>
			<label for="category" class="nb-label">Category</label>
			<select id="category" name="category" class="nb-input">
				{#each USER_CATEGORIES as category (category.value)}
					<option value={category.value} selected={category.value === (values.category ?? 'doctor')}>
						{category.label}
					</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="role" class="nb-label">User type</label>
			<select id="role" name="role" class="nb-input">
				{#each USER_ROLES as role (role.value)}
					<option value={role.value} selected={role.value === (values.role ?? 'viewer')}>
						{role.label}
					</option>
				{/each}
			</select>
		</div>
	</div>

	<fieldset class="border-2 border-ink p-4 shadow-brutal-sm">
		<legend class="px-2 text-sm font-bold uppercase">Standard sessions</legend>
		<p class="mb-3 text-sm">
			Tick the half-day sessions this person normally works — mornings only, afternoons only, or
			any mix. “Use default values” on an empty week marks these as Working; any session can
			still be set manually on the rota.
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
						<th scope="row" class="pr-4 py-1 text-left font-bold">{day.label}</th>
						{#each PERIODS as period (period.value)}
							<td class="px-3 py-1 text-center">
								<input
									type="checkbox"
									name="workingSlots"
									value={slotKey(day.value, period.value)}
									checked={(values.workingSlots ?? ALL_SLOTS).includes(
										slotKey(day.value, period.value)
									)}
									aria-label={`${day.label} ${period.label}`}
									class="size-5 accent-ink"
								/>
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</fieldset>

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
