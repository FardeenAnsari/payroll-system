const { Employee, WorkLog, Vacation } = require('../models');

// ===== Helper Functions =====

// Parse 'YYYY-MM-DD' or Date-like into a local Date (avoids UTC timezone shift)
function parseDateLocal(dateLike) {
  if (!dateLike) return null;
  if (dateLike instanceof Date) {
    return new Date(dateLike.getFullYear(), dateLike.getMonth(), dateLike.getDate());
  }
  const s = String(dateLike).slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Format a Date as YYYY-MM-DD in local time
function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ===== CRUD Controllers =====

exports.createEmployee = async (req, res) => {
  try {
    const employee = await Employee.create(req.body);
    res.status(201).json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getAllEmployees = async (req, res) => {
  try {
    const employees = await Employee.findAll();
    res.status(200).json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getEmployeeById = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });
    res.status(200).json(employee);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    await employee.update(req.body);
    res.status(200).json(employee);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    await employee.destroy();
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getEmployeeCount = async (req, res) => {
  try {
    const count = await Employee.count();
    res.status(200).json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ===== Payroll Calculation =====

exports.calculatePayroll = async (req, res) => {
  try {
    const { month } = req.query; // format: YYYY-MM
    if (!month) return res.status(400).json({ error: 'Month is required as YYYY-MM' });

    const employees = await Employee.findAll();
    const payroll = [];
    const { Op } = require('sequelize');
    const Holiday = require('../models').Holiday;
    const Vacation = require('../models').Vacation;

    // Get all public holidays for the year
    const [year, monthNum] = month.split('-').map(Number);
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const holidays = await Holiday.findAll({
      where: {
        date: { [Op.between]: [yearStart, yearEnd] }
      }
    });

    // Ensure same format for comparison
    const publicHolidaySet = new Set(
      holidays.map(h => formatDateLocal(parseDateLocal(h.date)))
    );

    // Loop through all employees
    for (const emp of employees) {
      let pay = 0;
      let vacationDeductions = [];

      if (emp.role === 'salaried') {
        // Use monthly base pay for salaried employees (salary stored as annual)
        pay = (emp.salary || 0) / 12;

        // Get all vacations for this employee in the year
        const vacations = await Vacation.findAll({
          where: {
            employeeId: emp.id,
            startDate: { [Op.lte]: `${year}-12-31` },
            endDate: { [Op.gte]: `${year}-01-01` }
          }
        });

        // Define quarters
        const quarters = [
          { start: new Date(year, 0, 1), end: new Date(year, 2, 31) },
          { start: new Date(year, 3, 1), end: new Date(year, 5, 30) },
          { start: new Date(year, 6, 1), end: new Date(year, 8, 30) },
          { start: new Date(year, 9, 1), end: new Date(year, 11, 31) },
        ];

        for (const { start, end } of quarters) {
          // Count vacation weekdays in this quarter
          let totalVacDays = 0;
          const vacDaysPerMonth = [0, 0, 0];

          for (const vac of vacations) {
            const vacStartRaw = parseDateLocal(vac.startDate);
            const vacEndRaw = parseDateLocal(vac.endDate);
            if (!vacStartRaw || !vacEndRaw) continue;

            const vacStart = new Date(Math.max(vacStartRaw.getTime(), start.getTime()));
            const vacEnd = new Date(Math.min(vacEndRaw.getTime(), end.getTime()));

            vacStart.setHours(0, 0, 0, 0);
            vacEnd.setHours(0, 0, 0, 0);
            if (vacStart > vacEnd) continue;

            for (let d = new Date(vacStart); d.getTime() <= vacEnd.getTime(); d.setDate(d.getDate() + 1)) {
              const iso = formatDateLocal(d);
              if (d.getDay() < 5 && !publicHolidaySet.has(iso)) {
                totalVacDays++;
                const relMonth = d.getMonth() - start.getMonth();
                if (relMonth >= 0 && relMonth < 3) vacDaysPerMonth[relMonth]++;
              }
            }
          }

          if (totalVacDays > 2) {
            const extraDays = totalVacDays - 2;
            const allocations = [0, 0, 0];
            const fractions = [0, 0, 0];
            let allocated = 0;

            for (let i = 0; i < 3; i++) {
              if (vacDaysPerMonth[i] > 0) {
                const exact = (extraDays * vacDaysPerMonth[i]) / totalVacDays;
                allocations[i] = Math.floor(exact);
                fractions[i] = exact - allocations[i];
                allocated += allocations[i];
              }
            }

            // Distribute leftover
            let leftover = extraDays - allocated;
            const idxs = [0, 1, 2].sort((a, b) => fractions[b] - fractions[a]);
            for (let k = 0; k < 3 && leftover > 0; k++) {
              allocations[idxs[k]] += 1;
              leftover--;
            }

            // Apply deduction for the current month
            for (let m = start.getMonth(); m <= end.getMonth(); m++) {
              const rel = m - start.getMonth();
              const monthStart = new Date(year, m, 1);
              const monthEnd = new Date(year, m + 1, 0);

              let workingDays = 0;
              for (let d = new Date(monthStart); d.getTime() <= monthEnd.getTime(); d.setDate(d.getDate() + 1)) {
                const iso = formatDateLocal(d);
                if (d.getDay() < 5 && !publicHolidaySet.has(iso)) workingDays++;
              }

              const daysThisMonth = allocations[rel] || 0;
              if (m + 1 === monthNum && daysThisMonth > 0 && workingDays > 0) {
                const dailySalary = (emp.salary || 0) / 12 / workingDays;
                const deductionAmount = Math.round(dailySalary * daysThisMonth * 100) / 100;

                vacationDeductions.push({
                  month: `${year}-${(m + 1).toString().padStart(2, '0')}`,
                  deduct_days: daysThisMonth,
                  amount: deductionAmount
                });
                  // Debug log to help trace why deductions may not be applied
                  console.log(`Payroll debug: ${emp.fullName} ${year}-${String(m+1).padStart(2,'0')} vacDaysPerMonth=${vacDaysPerMonth.join(',')} totalVacDays=${totalVacDays} extraDays=${extraDays} alloc=${allocations.join(',')} daysThisMonth=${daysThisMonth} workingDays=${workingDays} deduction=${deductionAmount}`);

                pay -= deductionAmount;
              }
            }
          }
        }
      } else if (emp.role === 'hourly') {
        const startDate = `${month}-01`;
        const lastDay = new Date(year, monthNum, 0).getDate();
        const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;

        const logs = await WorkLog.findAll({
          where: {
            employeeId: emp.id,
            date: { [require('sequelize').Op.between]: [startDate, endDate] }
          }
        });

        const totalHours = logs.reduce((sum, log) => sum + (log.hoursWorked || 0), 0);
        pay = (emp.hourlyRate || 0) * totalHours;
      }

      payroll.push({
        employee: {
          id: emp.id,
          fullName: emp.fullName,
          role: emp.role
        },
        pay,
        vacationDeductions
      });
    }

    res.json(payroll);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ===== Employee Summary =====

exports.getEmployeeSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const { month } = req.query;

    const employee = await Employee.findByPk(id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const workLogs = await WorkLog.findAll({
      where: { employeeId: id },
      order: [['date', 'DESC']]
    });

    const vacations = await Vacation.findAll({
      where: { employeeId: id },
      order: [['startDate', 'DESC']]
    });

    const totalWorkDays = workLogs.length;
    const totalHoursWorked = workLogs.reduce((sum, log) => sum + (log.hoursWorked || 0), 0);
    const totalVacationDays = vacations.reduce((sum, vac) => {
      const start = parseDateLocal(vac.startDate);
      const end = parseDateLocal(vac.endDate);
      return sum + Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    }, 0);

    let monthlyPay = 0;
    let monthlyBasePay = 0;
    let vacationDeduction = 0;
    let vacationDeductionDetails = null;

    if (month) {
      const { Op } = require('sequelize');
      const Holiday = require('../models').Holiday;
      const [year, monthNum] = month.split('-').map(Number);

      const holidays = await Holiday.findAll({
        where: { date: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] } }
      });
      const publicHolidaySet = new Set(
        holidays.map(h => formatDateLocal(parseDateLocal(h.date)))
      );

      if (employee.role === 'salaried') {
        monthlyBasePay = Math.round((employee.salary || 0) / 12 * 100) / 100;
        monthlyPay = monthlyBasePay;

        const quarters = [
          { start: new Date(year, 0, 1), end: new Date(year, 2, 31) },
          { start: new Date(year, 3, 1), end: new Date(year, 5, 30) },
          { start: new Date(year, 6, 1), end: new Date(year, 8, 30) },
          { start: new Date(year, 9, 1), end: new Date(year, 11, 31) },
        ];

        for (const { start, end } of quarters) {
          if (monthNum - 1 < start.getMonth() || monthNum - 1 > end.getMonth()) continue;

          let totalVacDays = 0;
          for (const vac of vacations) {
            const vacStart = parseDateLocal(vac.startDate);
            const vacEnd = parseDateLocal(vac.endDate);
            const startClamped = new Date(Math.max(vacStart, start));
            const endClamped = new Date(Math.min(vacEnd, end));

            for (let d = new Date(startClamped); d <= endClamped; d.setDate(d.getDate() + 1)) {
              const iso = formatDateLocal(d);
              if (d.getDay() < 5 && !publicHolidaySet.has(iso)) totalVacDays++;
            }
          }

          if (totalVacDays > 2) {
            const extraDays = totalVacDays - 2;
            const monthStart = new Date(year, monthNum - 1, 1);
            const monthEnd = new Date(year, monthNum, 0);

            let workingDays = 0;
            for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
              const iso = formatDateLocal(d);
              if (d.getDay() < 5 && !publicHolidaySet.has(iso)) workingDays++;
            }

            const daysThisMonth = Math.floor(extraDays / 3);
            const dailySalary = (employee.salary || 0) / 12 / workingDays;
            const deductionAmount = Math.round(dailySalary * daysThisMonth * 100) / 100;

            vacationDeduction = deductionAmount;
            vacationDeductionDetails = {
              month,
              deduct_days: daysThisMonth,
              amount: deductionAmount
            };

            monthlyPay -= deductionAmount;
          }
        }
      } else if (employee.role === 'hourly') {
        const startDate = `${month}-01`;
        const lastDay = new Date(year, monthNum, 0).getDate();
        const endDate = `${month}-${String(lastDay).padStart(2, '0')}`;
        const monthlyLogs = await WorkLog.findAll({
          where: {
            employeeId: id,
            date: { [Op.between]: [startDate, endDate] }
          }
        });
        const monthlyHours = monthlyLogs.reduce((sum, log) => sum + (log.hoursWorked || 0), 0);
        monthlyPay = (employee.hourlyRate || 0) * monthlyHours;
      }
    }

    const recentWorkLogs = workLogs.slice(0, 10);
    const recentVacations = vacations.slice(0, 5);

    res.json({
      employee,
      summary: {
        totalWorkDays,
        totalHoursWorked,
        totalVacationDays,
        monthlyPay: month ? monthlyPay : null,
        monthlyBasePay: month ? monthlyBasePay : null,
        vacationDeduction: month ? vacationDeduction : null,
        vacationDeductionDetails: month ? vacationDeductionDetails : null,
        averageHoursPerDay: totalWorkDays > 0 ? (totalHoursWorked / totalWorkDays).toFixed(2) : 0
      },
      recentWorkLogs,
      recentVacations,
      allWorkLogs: workLogs,
      allVacations: vacations
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
