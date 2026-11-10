import ReactDOM from 'react-dom';

/* A panel on the right side of the screen, like benefit editing on the Card
   page. It never closes on a backdrop click or Escape; only the buttons inside
   it close it (house rule). */
export function SidePanel({label,onClose,children,footer}){
  return ReactDOM.createPortal(
    <div className="c-spo cloud">
      <div className="c-sp" role="dialog" aria-modal="true" aria-label={label}>
        <div className="c-sph"><h3>{label}</h3><button type="button" className="c-x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="c-spb">{children}</div>
        {footer&&<div className="c-spf">{footer}</div>}
      </div>
    </div>,document.body);
}
