import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import './RunSummary.css';

export interface RunSummaryProps {
  /** Number of the pipeline run, as Azure Pipelines shows it. */
  run: string;
  result: 'succeeded' | 'failed';
  onRerun?: () => void;
}

/** What a reviewer sees first about a pipeline run: its result and what it published. */
export function RunSummary({ run, result, onRerun }: RunSummaryProps) {
  const failed = result === 'failed';
  return (
    <div className="demo-run">
      <div className="demo-run-header">
        <h2>Run #{run}</h2>
        <Badge status={result}>{failed ? 'Failed' : 'Succeeded'}</Badge>
        <Button label="Rerun" variant={failed ? 'primary' : 'secondary'} size="small" onClick={onRerun} />
      </div>
      <div className="demo-run-cards">
        <Card title="Storybook" status={<Badge status={failed ? 'neutral' : 'succeeded'}>{failed ? 'Skipped' : 'Published'}</Badge>}>
          {failed
            ? 'The build failed before the Storybook was built.'
            : 'Browse the stories of this run in the Storybook tab.'}
        </Card>
        <Card title="Tests" status={<Badge status={result}>{failed ? '3 failed' : 'All passed'}</Badge>}>
          {failed ? '39 of 42 tests passed.' : '42 of 42 tests passed.'}
        </Card>
      </div>
    </div>
  );
}
