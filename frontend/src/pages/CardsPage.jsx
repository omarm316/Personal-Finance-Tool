import {useIsMobile} from '../hooks/index';
import {CardsPhonePage} from './CardsPhonePage';
import {CardsDesktop} from './cards/CardsDesktop';

/* Cards: the rebuilt Portfolio, program and card pages on desktop (Cards
   step 5); phones keep today's pages until their own design. */
export function CardsPage(props){
  const mobile=useIsMobile();
  return mobile?<CardsPhonePage {...props}/>:<CardsDesktop {...props}/>;
}
