import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { GET } from '../routes/export/+server';
import { addWeeks, currentWeekStart } from '$lib/dates';
import { createEntry, createUser, resetDb } from './helpers';

type ExportEvent = Parameters<typeof GET>[0];

async function exportSheet(week?: string): Promise<ExcelJS.Worksheet> {
	const url = new URL(`http://localhost/export${week ? `?week=${week}` : ''}`);
	const response = await GET({ url } as ExportEvent);
	expect(response.headers.get('Content-Type')).toContain('spreadsheetml');
	expect(response.headers.get('Content-Disposition')).toContain(
		`rota-${week ?? currentWeekStart()}.xlsx`
	);
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(await response.arrayBuffer());
	return workbook.worksheets[0];
}

const cell = (sheet: ExcelJS.Worksheet, r: number, c: number) =>
	sheet.getRow(r).getCell(c).value;

describe('xlsx export', () => {
	beforeEach(resetDb);

	it('lays out initials across the top and sessions down the side', async () => {
		await createUser({ initials: 'DR1', displayOrder: 10 });
		await createUser({ initials: 'ANP1', displayOrder: 20, category: 'anp' });

		const sheet = await exportSheet();
		expect(cell(sheet, 1, 2)).toBe('DR1');
		expect(cell(sheet, 1, 3)).toBe('ANP1');
		expect(cell(sheet, 2, 1)).toBe('Monday AM');
		expect(cell(sheet, 3, 1)).toBe('Monday PM');
		expect(cell(sheet, 11, 1)).toBe('Friday PM');
	});

	it('orders columns by display order', async () => {
		await createUser({ initials: 'SECOND', displayOrder: 20 });
		await createUser({ initials: 'FIRST', displayOrder: 10 });

		const sheet = await exportSheet();
		expect(cell(sheet, 1, 2)).toBe('FIRST');
		expect(cell(sheet, 1, 3)).toBe('SECOND');
	});

	it('writes status labels, defaulting unscheduled slots to Not working', async () => {
		const user = await createUser({ initials: 'DR1', workingSlots: '["1:AM","1:PM","2:AM"]' });
		await createEntry(user.id, 1, 'AM');
		await createEntry(user.id, 1, 'PM', { location: 'ratho' });
		// 2:AM available but no entry saved.

		const sheet = await exportSheet();
		expect(cell(sheet, 2, 2)).toBe('Working'); // Monday AM
		expect(cell(sheet, 3, 2)).toBe('Working (Ratho)'); // Monday PM
		expect(cell(sheet, 4, 2)).toBe('Not working'); // Tuesday AM, unscheduled
	});

	it('labels duty sessions', async () => {
		const user = await createUser({ initials: 'DR1' });
		await createEntry(user.id, 1, 'AM', { duty: true });
		await createEntry(user.id, 1, 'PM', { location: 'ratho', duty: true });

		const sheet = await exportSheet();
		expect(cell(sheet, 2, 2)).toBe('Working (Duty)');
		expect(cell(sheet, 3, 2)).toBe('Working (Ratho, Duty)');
	});

	it('exports entries outside standard availability too', async () => {
		const user = await createUser({ initials: 'DR1', workingSlots: '["1:AM"]' });
		await createEntry(user.id, 5, 'PM', { location: 'ratho' }); // non-standard extra session

		const sheet = await exportSheet();
		expect(cell(sheet, 11, 2)).toBe('Working (Ratho)'); // Friday PM
	});

	it('excludes inactive and off-rota users', async () => {
		await createUser({ initials: 'SHOWN', displayOrder: 10 });
		await createUser({ initials: 'GONE', displayOrder: 20, active: false });
		await createUser({ initials: 'HIDDEN', displayOrder: 30, onRota: false });

		const sheet = await exportSheet();
		expect(cell(sheet, 1, 2)).toBe('SHOWN');
		expect(cell(sheet, 1, 3)).toBeNull();
	});

	it('produces a sheet even with no users', async () => {
		const sheet = await exportSheet();
		expect(cell(sheet, 2, 1)).toBe('Monday AM');
	});

	it('exports only the requested week', async () => {
		const user = await createUser({ initials: 'DR1' });
		const nextWeek = addWeeks(currentWeekStart(), 1);
		await createEntry(user.id, 1, 'AM', { location: 'ratho' }); // this week
		await createEntry(user.id, 1, 'AM', { weekStart: nextWeek, duty: true });

		expect(cell(await exportSheet(), 2, 2)).toBe('Working (Ratho)');
		expect(cell(await exportSheet(nextWeek), 2, 2)).toBe('Working (Duty)');
		expect(cell(await exportSheet(addWeeks(nextWeek, 3)), 2, 2)).toBe('Not working');
	});
});
