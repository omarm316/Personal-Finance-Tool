import {useIsMobile} from '../hooks/index';
import {BudgetsPhonePage} from './BudgetsPhonePage';
import {BudgetsDesktop} from './budgets/BudgetsDesktop';

/* Budgets. Desktop follows docs/budgets-design.md; the phone keeps its
   earlier layout until phone design is done for this screen. */
export function BudgetsPage(props){
  const mobile=useIsMobile();
  return mobile?<BudgetsPhonePage {...props}/>:<BudgetsDesktop {...props}/>;
}
