import ExcelJS from 'exceljs';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduleEntries, users } from '$lib/server/db/schema';
import { PERIODS, WEEKDAYS, cellLabel, type LocationValue } from '$lib/constants';
import { resolveWeek } from '$lib/dates';
import type { RequestHandler } from './$types';

/**
 * Downloads one week's rota as .xlsx (?week=YYYY-MM-DD, defaulting to the
 * current week), matching example.xlsx: staff initials across the top,
 * "Monday AM" … "Friday PM" down the side.
 */
export const GET: RequestHandler = async ({ url }) => {
	const week = resolveWeek(url.searchParams.get('week'));
	const rotaUsers = await db
		.select({
			id: users.id,
			initials: users.initials
		})
		.from(users)
		.where(and(eq(users.active, true), eq(users.onRota, true)))
		.orderBy(asc(users.displayOrder), asc(users.initials));

	const entries = rotaUsers.length
		? await db
				.select()
				.from(scheduleEntries)
				.where(
					and(
						eq(scheduleEntries.weekStart, week),
						inArray(
							scheduleEntries.userId,
							rotaUsers.map((u) => u.id)
						)
					)
				)
		: [];

	const grid = new Map<string, string>();
	for (const entry of entries) {
		grid.set(
			`${entry.userId}:${entry.weekday}:${entry.period}`,
			cellLabel({
				status: entry.status === 'working' ? 'working' : 'not_working',
				location: (entry.location as LocationValue | null) ?? null,
				duty: entry.duty
			})
		);
	}

	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet(`Rota w-c ${week}`);

	// Header row: blank corner, then initials.
	const header = sheet.getRow(1);
	rotaUsers.forEach((user, i) => {
		header.getCell(i + 2).value = user.initials;
	});
	header.font = { bold: true };

	// Body: one row per weekday × period.
	let rowIndex = 2;
	for (const day of WEEKDAYS) {
		for (const period of PERIODS) {
			const row = sheet.getRow(rowIndex++);
			row.getCell(1).value = `${day.label} ${period.label}`;
			row.getCell(1).font = { bold: true };
			rotaUsers.forEach((user, i) => {
				row.getCell(i + 2).value =
					grid.get(`${user.id}:${day.value}:${period.value}`) ?? 'Not working';
			});
		}
	}

	// Presentation: sensible column widths, borders, frozen header row/column.
	sheet.getColumn(1).width = 18;
	for (let c = 2; c <= rotaUsers.length + 1; c++) sheet.getColumn(c).width = 16;
	const thin = { style: 'thin' as const };
	for (let r = 1; r <= 1 + WEEKDAYS.length * PERIODS.length; r++) {
		for (let c = 1; c <= rotaUsers.length + 1; c++) {
			sheet.getCell(r, c).border = { top: thin, left: thin, bottom: thin, right: thin };
		}
	}
	sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];

	const buffer = await workbook.xlsx.writeBuffer();

	return new Response(new Uint8Array(buffer), {
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'Content-Disposition': `attachment; filename="rota-${week}.xlsx"`
		}
	});
};
