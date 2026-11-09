import { ChangeDetectionStrategy, Component } from '@angular/core';

import { CourseTasks } from '../course-tasks/course-tasks';
import { ProcessTable } from '../process-table/process-table';

@Component({
  selector: 'app-course-process',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CourseTasks, ProcessTable],
  template: `
    <app-process-table />
    <app-course-tasks />
  `,
})
export class CourseProcess {}
