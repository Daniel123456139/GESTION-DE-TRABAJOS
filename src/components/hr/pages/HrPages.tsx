import React from 'react';
// Components
import { JobManagement } from '../../../pages/JobManagement';
import { useHrLayout } from '../HrLayout';

export const HrJobsPage: React.FC = () => {
    const {
        startDate, setStartDate, endDate, setEndDate,
        startTime, endTime,
        erpData, datasetResumen, isReloading,
        departmentFilteredEmployees, selectedDepartment, setSelectedDepartment, computedDepartments,
        employeeCalendarsByDate, lastUpdated, reloadFromServer
    } = useHrLayout();

    return (
        <JobManagement
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            startTime={startTime}
            endTime={endTime}
            erpData={erpData}
            datasetResumen={datasetResumen}
            isReloading={isReloading}
            departmentFilteredEmployees={departmentFilteredEmployees as any}
            selectedDepartment={selectedDepartment}
            setSelectedDepartment={setSelectedDepartment}
            computedDepartments={computedDepartments}
            employeeCalendarsByDate={employeeCalendarsByDate}
            lastUpdated={lastUpdated}
            reloadFromServer={() => Promise.resolve(reloadFromServer()).then(() => undefined)}
        />
    );
};
