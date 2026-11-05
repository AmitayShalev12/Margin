import { ChangeDetectionStrategy, Component } from '@angular/core';

import { CourseTasks } from '../course-tasks/course-tasks';
import { ProcessFlow } from '../process-flow/process-flow';

@Component({
  selector: 'app-course-process',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CourseTasks, ProcessFlow],
  template: `
    <app-process-flow />
    <app-course-tasks />
  `,
})
export class CourseProcess {}
