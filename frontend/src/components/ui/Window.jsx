import ReactDOM from 'react-dom';

/* A window in the middle of the screen. It never closes on a backdrop click
   or Escape; only the buttons inside it close it (house rule). */
export function Window({label,size='',children}){
  return ReactDOM.createPortal(
    <div className="c-ovl cloud">
      <div className={`c-win ${size}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,document.body);
}
